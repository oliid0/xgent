Android PRoot source and modifications
=====================================

The Android PRoot executable is prepared by
`scripts/mobile/prepare-proot-android.sh` from the Termux source repository:

- Repository: https://github.com/termux/proot
- Version: 5.1.107.92
- Commit: 7266fb3e8516535682f5a9c8f3a7e70f6506eddb
- Tag: v5.1.107.92
- Local modification: scripts/mobile/proot-android-fork.patch
- Build identifier: termux-5.1.107.92-xgent-fork1

The same script fetches talloc 2.4.4 from
https://www.samba.org/ftp/talloc/talloc-2.4.4.tar.gz
(SHA-256 55e47994018c13743485544e7206780ffbb3c8495e704a99636503e6e77abf59)
and libandroid-shmem v0.7 from
https://github.com/termux/libandroid-shmem/archive/refs/tags/v0.7.tar.gz
(SHA-256 1e5ff8459bc0a8c229dd8a94b27d119987e09ef3414331c2b5ebfff20b98e867),
then applies `scripts/mobile/android-shmem-tmpdir.patch`.

The release checkout at https://github.com/oliid0/xgent contains these preparation
scripts and patches. Use the commit corresponding to the app release together
with the upstream source versions above to reproduce the modified sources.
PRoot's upstream copyright and GPL 2 text are preserved in LICENSES/PRoot-GPL-2.0.txt;
the talloc LGPL 3 and underlying GPL 3 texts are included alongside it.
