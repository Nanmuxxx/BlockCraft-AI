import { protocol } from './protocol.mjs'

// Package claims pinned from baseline package-lock.json (React) and registry.npmjs.org
// esbuild/0.25.12 dist metadata (2026-10-18). No package downloaded or installed.
// These SRI claims are NOT verification of installed/downloaded package bytes.
export const PACKAGE_PINS = Object.freeze({
  react: Object.freeze({ version: '19.3.1', integrity: 'sha512-QNhWdt7nrgVWWQG58QuGsAR3jv3Hbe4mb4vz7w2csnHavciZJgda1CPNaldF6eVxv90ud3jUXpKlHL69gO38yw==' }),
  'react-dom': Object.freeze({ version: '19.3.1', integrity: 'sha512-Y0bARz53lhEC1NMCASs0/j+faB/zqt3R8hpvg1e8+61ZVJ4UL0UdC4cBbXfZMcIuhrfgeILTLe+ZeBCavQPtKQ==' }),
})
export const BUILD_PIN = Object.freeze({
  profile: 'react-isolated-v1',
  toolchain: Object.freeze({ name: 'esbuild', version: '0.25.12', integrity: 'sha512-bbPBYYrtZbkt6Os6FiTLCTFxvq4tt3JKall1vRwshA3fdVztsLAatFaZobhkBC8/BrPetoa0oksYoKXoG4ryJg==' }),
  target: 'es2020', format: 'esm', maxBundleBytes: protocol.ARTIFACT_POLICY.maxBundleBytes,
})
export const IMPORTS = Object.freeze({
  react: 'react', 'react/jsx-runtime': 'react', 'react-dom': 'react-dom', 'react-dom/client': 'react-dom',
})
