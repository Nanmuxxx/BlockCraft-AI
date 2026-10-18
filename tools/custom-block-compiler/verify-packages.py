"""Trusted setup/offline verifier. Never reads a SourceArtifact or executes package code."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import stat
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parent
LOCK_SHA256 = '81e1ad412fefdc1cfc9f66c51da8ec28dbffe03f7956666bd17117d557f04fbe'
VERSIONS = {'esbuild': '0.25.12', 'react': '19.3.1', 'react-dom': '19.3.1',
            'scheduler': '0.28.0', 'typescript': '5.9.3'}


def require(value, code):
    if not value:
        raise ValueError(code)


def regular(path):
    require(stat.S_ISREG(path.lstat().st_mode), 'NON_REGULAR_FILE')
    return path.read_bytes()


def tree(directory):
    require(directory.is_dir() and not directory.is_symlink(), 'PACKAGE_DIRECTORY')
    result = {}
    for parent, dirs, files in os.walk(directory, followlinks=False):
        for name in dirs:
            require(not (Path(parent) / name).is_symlink(), 'PACKAGE_SYMLINK')
        for name in files:
            file = Path(parent) / name
            result[file.relative_to(directory).as_posix()] = hashlib.sha256(regular(file)).hexdigest()
    return result


def verify(fetch=False):
    lock_bytes = regular(ROOT / 'package-lock.json')
    require(hashlib.sha256(lock_bytes).hexdigest() == LOCK_SHA256, 'LOCK_DIGEST_MISMATCH')
    lock = json.loads(lock_bytes)
    host = {'Darwin': 'darwin', 'Linux': 'linux'}.get(platform.system())
    arch = {'arm64': 'arm64', 'aarch64': 'arm64', 'x86_64': 'x64'}.get(platform.machine())
    require(host and arch, 'UNSUPPORTED_BUILD_HOST')
    binary = f'@esbuild/{host}-{arch}'
    pins = {**VERSIONS, binary: '0.25.12'}
    cache = ROOT / '.packages'
    if fetch:
        cache.mkdir(mode=0o700, exist_ok=True)
    require(cache.is_dir() and not cache.is_symlink(), 'PACKAGE_CACHE_MISSING')
    report = []
    for name, version in pins.items():
        pin = lock['packages']['node_modules/' + name]
        require(pin['version'] == version, 'PACKAGE_VERSION')
        expected_url = f'https://registry.npmjs.org/{name}/-/{name.split("/")[-1]}-{version}.tgz'
        require(pin['resolved'] == expected_url, 'PACKAGE_URL')
        archive = cache / (name.replace('/', '--') + '.tgz')
        if fetch:
            # System curl uses the OS CA store; TLS verification stays enabled. No redirects.
            response = subprocess.run(['curl', '--proto', '=https', '--max-time', '30',
                                       '--max-filesize', '33554432', '--fail', '--silent',
                                       '--show-error', expected_url], capture_output=True, timeout=35)
            require(response.returncode == 0, 'PACKAGE_DOWNLOAD')
            data = response.stdout
            require(len(data) <= 32 * 1024 * 1024, 'PACKAGE_SIZE')
            require('sha512-' + base64.b64encode(hashlib.sha512(data).digest()).decode() == pin['integrity'], 'PACKAGE_SRI')
            require(not archive.is_symlink(), 'CACHE_SYMLINK')
            archive.write_bytes(data)
        data = regular(archive)
        require('sha512-' + base64.b64encode(hashlib.sha512(data).digest()).decode() == pin['integrity'], 'PACKAGE_SRI')
        expected = {}
        with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as tar:
            for member in tar:
                require(member.name.startswith('package/') and '..' not in member.name.split('/'), 'TAR_PATH')
                if member.isdir():
                    continue
                require(member.isfile() and member.name[8:] not in expected, 'TAR_ENTRY')
                expected[member.name[8:]] = hashlib.sha256(tar.extractfile(member).read()).hexdigest()
        actual = tree(ROOT / 'node_modules' / name)
        require(actual == expected, 'INSTALLED_PACKAGE_BYTES:' + name)
        metadata = json.loads(regular(ROOT / 'node_modules' / name / 'package.json'))
        require(metadata['name'] == name and metadata['version'] == version, 'INSTALLED_PACKAGE_ID')
        # Existing import-policy uses the repo's TypeScript. Verify those bytes too.
        if name == 'typescript':
            require(tree((ROOT.parent.parent / 'node_modules' / name).resolve()) == expected, 'HOST_PARSER_BYTES')
        inventory_digest = hashlib.sha256(json.dumps(expected, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        report.append({'name': name, 'version': version, 'integrity': pin['integrity'],
                       'archiveSha256': hashlib.sha256(data).hexdigest(), 'treeSha256': inventory_digest,
                       'fileCount': len(expected)})
    executable = ROOT / 'node_modules' / binary / 'bin' / 'esbuild'
    require(os.access(executable, os.X_OK), 'COMPILER_NOT_EXECUTABLE')
    return {'lockDigest': 'sha256:' + LOCK_SHA256, 'platform': f'{host}-{arch}',
            'packages': report, 'binaryDigest': 'sha256:' + hashlib.sha256(regular(executable)).hexdigest()}


if __name__ == '__main__':
    try:
        require(sys.argv[1:] in ([], ['--fetch']), 'ARGUMENTS')
        print(json.dumps(verify(sys.argv[1:] == ['--fetch']), sort_keys=True))
    except Exception as error:
        # Never echo package contents, environment, URLs containing credentials or paths.
        print(json.dumps({'error': str(error) if isinstance(error, ValueError) else type(error).__name__}))
        sys.exit(1)
