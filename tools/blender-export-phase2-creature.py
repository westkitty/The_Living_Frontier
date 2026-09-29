import bpy
import json
import os
import sys

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(args) < 3:
    raise SystemExit("usage: blender --background <source.blend> --python tools/blender-export-phase2-creature.py -- <output.glb> <max-texture> <exclude-json> [palette-json]")

output, max_texture_s, exclude_json = args[:3]
palette_json = args[3] if len(args) > 3 else "{}"
max_texture = int(max_texture_s)
exclude_names = set(json.loads(exclude_json))
palette = json.loads(palette_json)
removed = []

for obj in list(bpy.data.objects):
    if obj.name in exclude_names or obj.type in {"CAMERA", "LIGHT"}:
        removed.append({"name": obj.name, "type": obj.type})
        bpy.data.objects.remove(obj, do_unlink=True)

for image in bpy.data.images:
    width, height = image.size[:]
    if width <= 0 or height <= 0 or max(width, height) <= max_texture:
        continue
    scale = max_texture / max(width, height)
    image.scale(max(1, round(width * scale)), max(1, round(height * scale)))

def srgb_to_linear(channel):
    c = channel / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def hex_rgba(value):
    raw = value.lstrip("#")
    if len(raw) not in {6, 8}:
        raise ValueError(f"invalid color {value}")
    rgb = tuple(srgb_to_linear(int(raw[i:i+2], 16)) for i in (0, 2, 4))
    alpha = int(raw[6:8], 16) / 255.0 if len(raw) == 8 else 1.0
    return (*rgb, alpha)

applied_palette = {}
for name, value in palette.items():
    mat = bpy.data.materials.get(name)
    if not mat:
        raise RuntimeError(f"palette material not found: {name}")
    rgba = hex_rgba(value)
    mat.diffuse_color = rgba
    mat.use_nodes = True
    bsdf = next((node for node in mat.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
    if bsdf:
        bsdf.inputs["Base Color"].default_value = rgba
        if "Roughness" in bsdf.inputs:
            bsdf.inputs["Roughness"].default_value = 0.82
    applied_palette[name] = value

mesh_names = sorted(obj.name for obj in bpy.data.objects if obj.type == "MESH")
armatures = sorted(obj.name for obj in bpy.data.objects if obj.type == "ARMATURE")
if not mesh_names:
    raise RuntimeError("no mesh objects remain after source cleanup")
if not armatures:
    raise RuntimeError("no armature remains after source cleanup")

os.makedirs(os.path.dirname(output), exist_ok=True)
result = bpy.ops.export_scene.gltf(
    filepath=output,
    export_format="GLB",
    export_yup=True,
    export_tangents=True,
)
if "FINISHED" not in result:
    raise RuntimeError(f"glTF export failed: {result}")
if not os.path.isfile(output) or os.path.getsize(output) <= 20:
    raise RuntimeError(f"glTF export did not produce a usable file: {output}")

print(json.dumps({
    "event": "PHASE2_CREATURE_GLB_OK",
    "source": bpy.data.filepath,
    "output": output,
    "bytes": os.path.getsize(output),
    "removed": removed,
    "meshes": mesh_names,
    "armatures": armatures,
    "actions": sorted(action.name for action in bpy.data.actions),
    "maxTexture": max_texture,
    "palette": applied_palette,
}, indent=2))
