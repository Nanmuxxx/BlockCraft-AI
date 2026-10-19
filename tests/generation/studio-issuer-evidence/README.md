# HTTPS Mock browser evidence

The GitHub connector publishes UTF-8 files only. Decode b.png.base64 and c.png.base64 to recover the exact native browser screenshots from local implementation commit 66d1895b6292db36c3ca7adfe7356f8052ea9ef9. These are Mock evidence, not proof of real DeepSeek calls.

```sh
openssl base64 -d -A -in b.png.base64 -out b.png
openssl base64 -d -A -in c.png.base64 -out c.png
shasum -a 256 b.png c.png
```

SHA256:

- b.png: 007f8b5953c48f22b48b462736a96e53916c1c7fc3898ed6fcdb9633aa6cfb79
- c.png: 19d428ea0c0c50a40c8ba14b95f713e4486b3a79e9832f8abe72016106eadde8

See ../studio-issuer-acceptance.md and report.json for scope and limitations.
