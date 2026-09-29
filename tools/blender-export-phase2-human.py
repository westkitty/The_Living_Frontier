import bpy
import json
import os
import sys

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(args) < 3:
    raise SystemExit("usage: blender --background <source.blend> --python tools/blender-export-phase2-human.py -- <output.glb> <max-texture> <exclude-json>")

output, max_texture_s, exclude_json = args[:3]
max_texture = int(max_texture_s)
exclude_names = set(json.loads(exclude_json))
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
    "event": "PHASE2_HUMAN_GLB_OK",
    "source": bpy.data.filepath,
    "output": output,
    "bytes": os.path.getsize(output),
    "removed": removed,
    "meshes": mesh_names,
    "armatures": armatures,
    "actions": sorted(action.name for action in bpy.data.actions),
    "maxTexture": max_texture,
}, indent=2))
