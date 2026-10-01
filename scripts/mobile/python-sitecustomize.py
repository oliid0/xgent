"""Restore Python's public installation prefixes after embedded Py_SetPath.

The C path configuration deliberately keeps its prefix empty so a-Shell's
extension loader uses APPDIR. Public sys prefixes still describe our installed
stdlib, as required by pip, sysconfig and virtual-environment detection.
"""
import os
import sys

_home = os.environ.get("PYTHONHOME")
if _home and not sys.prefix:
    sys.prefix = sys.exec_prefix = sys.base_prefix = sys.base_exec_prefix = _home
