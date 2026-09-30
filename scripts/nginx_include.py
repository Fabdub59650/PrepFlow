#!/usr/bin/env python3
"""
Ajoute « include snippets/prepflow.conf; » dans la configuration Nginx de FilaFlow,
juste avant chaque bloc « location / { ».
Usage : python3 nginx_include.py /etc/nginx/sites-available/filaflow
Codes de sortie : 0 = ajouté, 2 = déjà présent, 3 = aucun « location / » trouvé.
"""
import re
import sys

INCLUDE = "include snippets/prepflow.conf;"

path = sys.argv[1]
with open(path, encoding="utf-8") as fh:
    lines = fh.read().splitlines(keepends=True)

if any(INCLUDE in l and not l.lstrip().startswith("#") for l in lines):
    sys.exit(2)

out, added = [], 0
for line in lines:
    m = re.match(r"^(\s*)location\s+/\s*\{", line)
    if m:
        indent = m.group(1)
        out.append(f"{indent}# PrepFlow (https://<hôte>/prepflow/)\n")
        out.append(f"{indent}{INCLUDE}\n\n")
        added += 1
    out.append(line)

if not added:
    sys.exit(3)

with open(path, "w", encoding="utf-8") as fh:
    fh.writelines(out)
print(f"  ✓ include ajouté ({added} bloc{'s' if added > 1 else ''} server)")
