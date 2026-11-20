# Fabrique des fichiers 3MF de test « façon Bambu Studio » (objet principal + sous-fichier).
import zipfile, math, sys
def box(w, d, h, x0=0, y0=0):
    v = [(x0 + x, y0 + y, z) for z in (0, h) for y in (0, d) for x in (0, w)]
    f = [(0,2,1),(1,2,3),(4,5,6),(5,7,6),(0,1,4),(1,5,4),(2,6,3),(3,6,7),(0,4,2),(2,4,6),(1,3,5),(3,7,5)]
    return v, f
def sphere(r, n):
    v = []; f = []
    for i in range(n + 1):
        th = math.pi * i / n
        for j in range(2 * n):
            ph = 2 * math.pi * j / (2 * n)
            v.append((r * math.sin(th) * math.cos(ph), r * math.sin(th) * math.sin(ph), r + r * math.cos(th)))
    W = 2 * n
    for i in range(n):
        for j in range(W):
            a = i * W + j; b = i * W + (j + 1) % W; c = (i + 1) * W + j; d = (i + 1) * W + (j + 1) % W
            if i > 0: f.append((a, c, b))
            if i < n - 1: f.append((b, c, d))
    # pôles : sommets dupliqués à fusionner
    return v, f
def mesh_xml(v, f):
    vs = "".join(f'<vertex x="{x:.5f}" y="{y:.5f}" z="{z:.5f}"/>' for x, y, z in v)
    ts = "".join(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in f)
    return f"<mesh><vertices>{vs}</vertices><triangles>{ts}</triangles></mesh>"
def write(path, v, f, name):
    sub = f'<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model">{mesh_xml(v, f)}</object></resources><build/></model>'
    main = f'''<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p"><metadata name="Application">BambuStudio-01.10</metadata><resources><object id="2" p:UUID="0001" type="model" name="{name}"><components><component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></components></object></resources><build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 128 128 0" printable="1"/></build></model>'''
    rels = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'
    ct = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", ct); z.writestr("_rels/.rels", rels)
        z.writestr("3D/3dmodel.model", main); z.writestr("3D/Objects/object_1.model", sub)
        z.writestr("Metadata/plate_1.png", b"\x89PNG")
v, f = box(40, 30, 10); write("tools/fixtures/support.3mf", v, f, "Support")
n = int(sys.argv[1]) if len(sys.argv) > 1 else 40
v, f = sphere(15, n); write("tools/fixtures/boule.3mf", v, f, "Boule")
print("ok", len(f))
