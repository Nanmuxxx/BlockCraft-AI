"""Operator-owned, fail-closed execution grants. No credentials are opened here."""
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import sqlite3
import time


class GateError(RuntimeError):
    pass


def require(value, reason):
    if not value:
        raise GateError(reason)


def digest_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def private_json(path, repo, with_digest=False):
    path = Path(path)
    require(path.name not in ('auth.json', 'credentials.json') and path.suffix == '.json',
            'control file must be JSON policy, never authentication material')
    require(path.is_absolute() and not path.is_symlink(), 'control file must be absolute and not a symlink')
    path = path.resolve()
    require(not path.is_relative_to(Path(repo).resolve()), 'control file must be outside repository')
    require(path.is_file() and path.stat().st_size <= 32768, 'missing/oversized operator control file')
    require(os.name != 'nt', 'Windows control-file ACL gate NOT_VERIFIED')
    st = path.stat()
    require(st.st_uid == os.getuid() and st.st_mode & 0o077 == 0, 'control file must be operator-owned mode 0600')
    parent = path.parent.stat()
    require(parent.st_uid == os.getuid() and parent.st_mode & 0o077 == 0,
            'operator control directory must be owned mode 0700')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        actual = os.fstat(fd)
        require(actual.st_uid == os.getuid() and actual.st_mode & 0o077 == 0
                and actual.st_ino == st.st_ino and actual.st_dev == st.st_dev, 'control file changed before read')
        raw = os.read(fd, 32769)
        require(len(raw) <= 32768, 'operator control file exceeds bound')
    finally:
        os.close(fd)
    value = json.loads(raw)
    require(isinstance(value, dict), 'operator control must be a JSON object')
    return (value, hashlib.sha256(raw).hexdigest()) if with_digest else value


REQUIRED_CAPABILITIES = {
    'local_chatgpt_auth_only', 'deny_api_key_fallback', 'deny_credential_reads_by_tools',
    'deny_tool_network', 'deny_outside_scope_writes', 'deny_host_control_access',
    'cancel_entire_process_tree', 'deny_unreviewed_plugins_and_hooks',
}


class ExecutionPolicy:
    """Trusted operator record, not a signature or a substitute for independent isolation QA.

    No helper creates/approves these records. Existing authentication is used only by
    the trusted local runtime after both the owner grant and QA evidence gates pass.
    """
    def __init__(self, repo, grant_file, isolation_file, launcher, executable, auth_home, model):
        self.repo = Path(repo).resolve()
        self.grant_file, self.isolation_file = grant_file, isolation_file
        self.launcher, self.executable = Path(launcher), Path(executable)
        self.auth_home, self.model = Path(auth_home), model

    def _binary(self, path, expected):
        require(path.is_absolute() and not path.is_symlink(), 'runtime/launcher must be absolute nonsymlink paths')
        p = path.resolve()
        require(not p.is_relative_to(self.repo) and p.is_file() and os.access(p, os.X_OK), 'runtime/launcher must be installed outside repository')
        st = p.stat()
        require(st.st_uid in (0, os.getuid()) and st.st_mode & 0o022 == 0, 'unsafe runtime/launcher ownership or permissions')
        require(digest_file(p) == expected, 'runtime/launcher hash changed; new isolation QA required')

    def validate(self, role, now=None):
        now = time.time() if now is None else now
        require(role in ('worker', 'supervisor'), 'unknown model execution role')
        require(self.grant_file and self.isolation_file, 'BLOCKED: owner model grant and independent isolation QA required')
        for path in (self.grant_file, self.isolation_file):
            require(not Path(path).resolve().is_relative_to(self.auth_home.resolve()),
                    'control records must not be under authentication home')
        grant, grant_hash = private_json(self.grant_file, self.repo, with_digest=True)
        qa = private_json(self.isolation_file, self.repo)
        require(grant.get('backend') == 'codex-chatgpt-exec' and grant.get('auth') == 'existing-local-chatgpt', 'only existing ChatGPT login backend permitted')
        require(grant.get('approval_ref') and grant.get('approved_by') and grant.get('model') == self.model, 'owner approval/model mismatch')
        require(grant.get('roles') == ['worker', 'supervisor'] or grant.get('roles') == ['supervisor', 'worker'], 'both model roles must be explicitly approved')
        require(type(grant.get('valid_until')) in (int, float) and now < grant['valid_until'] <= now + 86400, 'expired/overlong execution grant')
        require(type(grant.get('max_runs')) is int and 1 <= grant['max_runs'] <= 10, 'bounded model run count required')
        require(grant.get('max_additional_api_spend_usd') == 0 and grant.get('allow_credit_purchase') is False, 'additional API spend/credit purchase forbidden')
        require(type(grant.get('timeout_seconds')) is int and 1 <= grant['timeout_seconds'] <= 120, 'bounded model deadline required')
        require(qa.get('status') == 'PASS' and qa.get('classification') == 'INDEPENDENT_OFFLINE_ISOLATION_QA', 'missing independent isolation PASS; MOCK cannot authorize')
        require(qa.get('reviewer') and qa.get('reviewer') != grant['approved_by'], 'isolation reviewer must be independent of approver')
        require(qa.get('platform') == platform.system(), 'isolation evidence belongs to another OS')
        require(type(qa.get('valid_until')) in (int, float) and now < qa['valid_until'], 'isolation QA expired')
        require(set(qa.get('capabilities', [])) == REQUIRED_CAPABILITIES, 'incomplete isolation capability evidence')
        require(qa.get('live_auth_boundary_verified') is True, 'existing-login runtime/tool credential boundary NOT_VERIFIED')
        require(qa.get('evidence_ref') and isinstance(qa.get('profile_sha256'), str)
                and re.fullmatch(r'[0-9a-f]{64}', qa['profile_sha256']), 'profile-bound isolation evidence required')
        require(not Path(qa.get('profile_file', '')).resolve().is_relative_to(self.auth_home.resolve()),
                'isolation profile cannot read authentication home')
        _, profile_hash = private_json(qa.get('profile_file', ''), self.repo, with_digest=True)
        require(profile_hash == qa['profile_sha256'], 'isolation profile changed; new QA required')
        self._binary(self.launcher, qa.get('launcher_sha256'))
        self._binary(self.executable, qa.get('runtime_sha256'))
        require(self.auth_home.is_absolute() and not self.auth_home.is_symlink(), 'explicit existing local auth home required')
        require(self.auth_home.resolve() == Path(grant.get('auth_home', '')).resolve(), 'auth identity path mismatch')
        require(not self.auth_home.resolve().is_relative_to(self.repo), 'auth location cannot be in repository')
        # Do not enumerate, read or copy anything under auth_home.
        require(digest_file(self.grant_file) == grant_hash, 'owner grant changed during validation')
        return dict(grant, _grant_sha256=grant_hash, _isolation_profile=qa['profile_file'])

    def reserve(self, role, now=None):
        grant = self.validate(role, now)
        # Same operator boundary as grant. Reserve before launch; failure never refunds
        # uncertain model usage. Concurrent processes cannot spend one slot twice.
        ledger = Path(self.grant_file).parent / 'model-runs.sqlite3'
        require(not ledger.is_symlink(), 'model run ledger cannot be symlink')
        c = sqlite3.connect(ledger, isolation_level=None, timeout=5)
        try:
            c.execute('CREATE TABLE IF NOT EXISTS reservations(grant_hash TEXT, role TEXT, time REAL)')
            c.execute('BEGIN IMMEDIATE')
            gh = grant['_grant_sha256']
            require(digest_file(self.grant_file) == gh, 'owner grant changed before reservation')
            count = c.execute('SELECT COUNT(*) FROM reservations WHERE grant_hash=?', (gh,)).fetchone()[0]
            require(count < grant['max_runs'], 'model execution count exhausted; no automatic retry')
            c.execute('INSERT INTO reservations VALUES(?,?,?)', (gh, role, time.time() if now is None else now))
            c.commit()
        except BaseException:
            c.rollback(); raise
        finally:
            c.close()
        return grant
