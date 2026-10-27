"""Native macOS OFFLINE probes only. Never an authenticated Codex launcher."""
import hashlib
import json
import os
from pathlib import Path
import platform
import socket
import subprocess
import sys
import tempfile

from .security import GateError, require


def profile(work, home):
    roots = [Path(work).resolve(), Path(home).resolve()]
    require(all(p.is_dir() and not p.is_symlink() for p in roots), 'fresh work/home directories required')
    require(roots[0] != roots[1] and not roots[0].is_relative_to(roots[1])
            and not roots[1].is_relative_to(roots[0]), 'work/home roots must be disjoint')
    def q(p): return json.dumps(str(p))
    reads = roots + [Path('/System'), Path('/usr'), Path('/bin'), Path('/sbin'),
                     Path('/Library/Apple'), Path(sys.base_prefix).resolve()]
    return '\n'.join(['(version 1)', '(deny default)', '(allow process*)', '(allow sysctl-read)',
        '(allow file-map-executable (subpath "/System") (subpath "/usr/lib") (subpath ' + q(Path(sys.base_prefix).resolve()) + '))',
        '(allow file-read-metadata (literal "/") (path-ancestors ' + q(roots[0]) + ') (path-ancestors ' + q(roots[1]) + '))',
        '(allow file-read* ' + ' '.join('(subpath ' + q(p) + ')' for p in reads) +
        ' (literal "/dev/null") (literal "/dev/random") (literal "/dev/urandom"))',
        '(allow file-write* ' + ' '.join('(subpath ' + q(p) + ')' for p in roots) +
        ' (literal "/dev/null"))']) + '\n'


def probe():
    require(platform.system() == 'Darwin' and Path('/usr/bin/sandbox-exec').is_file(),
            'native offline jail unavailable on this OS; NOT_VERIFIED')
    from .runtime import command
    with tempfile.TemporaryDirectory(prefix='supervisor-jail-probe-') as root:
        root = Path(root).resolve()
        work, home = root / 'work', root / 'home'
        work.mkdir(); home.mkdir()
        (work / 'fixture.txt').write_text('synthetic allowed fixture')
        outside = root / 'synthetic-credential.txt'
        outside.write_text('DUMMY_CREDENTIAL_DO_NOT_EXPORT')
        policy = profile(work, home)
        pf = root / 'profile.sb'; pf.write_text(policy)
        # A listening synthetic loopback endpoint proves denial isn't merely a
        # connection-refused result. No real service, public port or key is used.
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0)); listener.listen(1)
            script = '''import json,pathlib,socket,subprocess,sys
p=pathlib.Path(sys.argv[1]); result={}
result['allowed_workspace_read']=pathlib.Path('fixture.txt').read_text()=='synthetic allowed fixture'
pathlib.Path('allowed-output.txt').write_text('fixture'); result['allowed_workspace_write']=True
try: p.read_text(); result['outside_read_denied']=False
except PermissionError: result['outside_read_denied']=True
try: p.write_text('leak'); result['outside_write_denied']=False
except PermissionError: result['outside_write_denied']=True
try:
 s=socket.socket(); s.settimeout(1); s.connect(('127.0.0.1',int(sys.argv[2]))); result['network_denied']=False
except PermissionError: result['network_denied']=True
finally:
 try: s.close()
 except NameError: pass
child=subprocess.run([sys.executable,'-c',"import pathlib,sys;pathlib.Path(sys.argv[1]).read_text()",str(p)],capture_output=True,text=True)
result['descendant_read_denied']=child.returncode!=0 and 'PermissionError' in child.stderr
print(json.dumps(result))
'''
            run = command(['/usr/bin/sandbox-exec', '-f', str(pf), sys.executable, '-c', script,
                           str(outside), str(listener.getsockname()[1])], work, home, timeout=15)
        if run['exit_code'] != 0:
            return {'classification': 'OFFLINE_SYNTHETIC_JAIL_PROBE', 'status': 'BLOCKED',
                    'platform': platform.system(), 'exit_code': run['exit_code'],
                    'stderr': run['stderr'], 'checks': {},
                    'profile_sha256': hashlib.sha256(policy.encode()).hexdigest(),
                    'live_auth_boundary_verified': False,
                    'limitation': 'Probe did not run to completion. No isolation or model readiness claim.'}
        checks = json.loads(run['stdout'])
        require(set(checks) == {'allowed_workspace_read', 'allowed_workspace_write', 'outside_read_denied',
                              'outside_write_denied', 'network_denied', 'descendant_read_denied'}
                and all(value is True for value in checks.values()), 'offline jail boundary failed')
        require(outside.read_text() == 'DUMMY_CREDENTIAL_DO_NOT_EXPORT', 'probe fixture unexpectedly modified')
        return {'classification': 'OFFLINE_SYNTHETIC_JAIL_PROBE', 'status': 'PASS',
                'platform': platform.system(), 'profile_sha256': hashlib.sha256(policy.encode()).hexdigest(),
                'checks': checks, 'exit_code': run['exit_code'],
                'live_auth_boundary_verified': False,
                'limitation': 'Denies all network and auth-home reads; cannot launch logged-in Codex. Not live-model isolation QA.'}


if __name__ == '__main__':
    result = probe()
    print(json.dumps(result, indent=2))
    sys.exit(0 if result['status'] == 'PASS' else 1)
