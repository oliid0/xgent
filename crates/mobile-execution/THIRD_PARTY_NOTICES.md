Mobile execution release resources
=================================

The Android/iOS release script `scripts/mobile/prepare-mobile-legal-notices.sh`
copies this notice, the PRoot source information, and LICENSES into both apps.
The following execution components retain their upstream copyright and license
texts in that directory:

| Component | Source used by this repository | License text |
| --- | --- | --- |
| PRoot | termux/proot, 5.1.107.92, commit 7266fb3e8516535682f5a9c8f3a7e70f6506eddb | PRoot-GPL-2.0.txt |
| talloc | samba.org, 2.4.4; source header declares LGPL 3 or later | libtalloc-LGPL-3.0.txt and GNU-GPL-3.0.txt |
| libandroid-shmem | termux/libandroid-shmem, v0.7 | libandroid-shmem-BSD-3-Clause.txt |
| a-Shell resources | holzschu/a-shell, commit 0a0614464ec65a9480f4d44f95a85273a33a6dfa | a-shell-BSD-3-Clause.txt |
| ios_system | holzschu/ios_system, v3.0.4 | ios_system-BSD-3-Clause.txt |
| One True Awk | ios_system v3.0.4, awk-awk-35/src/LICENSE | OneTrueAwk.txt |
| WasmKit | swiftwasm/WasmKit, upstream MIT notice | WasmKit-MIT.txt |

Source repositories: https://github.com/termux/proot,
https://www.samba.org/ftp/talloc/, https://github.com/termux/libandroid-shmem,
https://github.com/holzschu/a-shell, https://github.com/holzschu/ios_system,
https://github.com/swiftwasm/WasmKit.

The dependency preparation scripts and Swift package manifests in this repository
record archive checksums and framework versions. Resource bundles and separately
installed toolchains also retain their own upstream component notices.
