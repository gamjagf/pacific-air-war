# Blender 안에서 실행: blender -b --disable-autoexec --python convert.py -- <in.blend> <out.glb|-> <maxTex>
import bpy, sys, os

argv = sys.argv[sys.argv.index("--") + 1:]
src, out, max_tex = argv[0], argv[1], int(argv[2])
bpy.ops.wm.open_mainfile(filepath=src, load_ui=False)
base = os.path.dirname(src)
files = {f.lower(): os.path.join(base, f) for f in os.listdir(base)}

# 1) 깨진 그림 경로를 같은 폴더의 같은 이름 파일로 다시 연결
for img in bpy.data.images:
    if img.source != 'FILE' or img.packed_file:
        continue
    name = os.path.basename(bpy.path.abspath(img.filepath).replace("\\", "/")).lower()
    if not os.path.exists(bpy.path.abspath(img.filepath)) and name in files:
        img.filepath = files[name]
        img.reload()

# 2) 보고서
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
tris = 0
for o in meshes:
    me = o.data
    me.calc_loop_triangles()
    tris += len(me.loop_triangles)
print("REPORT objects:", [(o.name, o.type, o.hide_render) for o in bpy.data.objects])
print("REPORT triangles:", tris)
for o in meshes:
    print("REPORT obj:", o.name, "tris", len(o.data.loop_triangles), "mats", [s.material.name if s.material else None for s in o.material_slots],
          "uv", len(o.data.uv_layers), "dim", tuple(round(v, 1) for v in o.dimensions), "parent", o.parent.name if o.parent else None)
for img in bpy.data.images:
    print("REPORT image:", img.name, img.filepath, tuple(img.size), "packed" if img.packed_file else "")
for mat in bpy.data.materials:
    has_img = mat.use_nodes and any(n.type == 'TEX_IMAGE' and n.image for n in mat.node_tree.nodes)
    print("REPORT material:", mat.name, "nodes" if mat.use_nodes else "no-nodes", "img" if has_img else "no-img",
          tuple(round(c, 2) for c in mat.diffuse_color))

if out == "-":
    sys.exit(0)

# 모델별 설정: 뺄 부품(이름 앞부분), 재질에 연결할 그림, 유리로 만들 재질
CONFIG = {
    "P51_Mustang.blend": {"drop": ["pilot"], "tex": {"p51": "P51_Mustang.tif"}, "glass": ["glass"]},
    "Zero.blend": {"drop": ["pilot", "Antenna.002"], "tex": {"zero": "Zero.tif"}, "glass": ["zerocanopy"]},
    "Bearn.blend": {"drop": ["4e2a", "BP-", "Cube"], "tex": {}, "glass": []},
}
cfg = CONFIG[os.path.basename(src)]

def bsdf_of(mat):
    # 새 Principled 셰이더를 만들어 '재질 출력'에 확실히 연결 (옛 재질 노드는 무시)
    mat.use_nodes = True
    nt = mat.node_tree
    print("REPORT old nodes:", mat.name, [n.type for n in nt.nodes])
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    out.is_active_output = True
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = tuple(mat.diffuse_color)
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    return bsdf

# 도색 그림을 재질의 기본 색(Base Color)에 연결
for mname, iname in cfg["tex"].items():
    mat, img = bpy.data.materials[mname], bpy.data.images[iname]
    bsdf = bsdf_of(mat)
    tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image = img
    mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.6
    bsdf.inputs['Metallic'].default_value = 0.2
    print("REPORT linked:", mname, "<-", iname)

# 조종석 덮개는 반투명 유리로
for mname in cfg["glass"]:
    mat = bpy.data.materials[mname]
    bsdf = bsdf_of(mat)
    bsdf.inputs['Base Color'].default_value = (0.55, 0.7, 0.8, 1)
    bsdf.inputs['Alpha'].default_value = 0.35
    bsdf.inputs['Roughness'].default_value = 0.1
    for attr, val in (("surface_render_method", 'BLENDED'), ("blend_method", 'BLEND')):
        try:
            setattr(mat, attr, val)
        except Exception:
            pass

# 뺄 부품 지우기 (사람 표현 없음 규칙, 참고용 설계도 등)
for o in list(meshes):
    if any(o.name.startswith(p) for p in cfg["drop"]):
        meshes.remove(o)
        bpy.data.objects.remove(o, do_unlink=True)

# 3) 그림 줄이기 (폰 속도 + 5MB 제한)
for img in bpy.data.images:
    if img.size[0] > max_tex or img.size[1] > max_tex:
        s = max_tex / max(img.size)
        img.scale(max(1, int(img.size[0] * s)), max(1, int(img.size[1] * s)))

# 4) 렌더에 숨겨진 것·메시 아닌 것은 빼고 내보내기
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    if not o.hide_render:
        o.hide_set(False)
        o.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=out, export_format='GLB', use_selection=True,
    export_apply=True, export_cameras=False, export_lights=False,
    export_image_format='JPEG', export_image_quality=85,
)
print("REPORT exported:", out, os.path.getsize(out))
