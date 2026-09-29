import bpy
import os
import sys

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(args) < 4:
    raise SystemExit("usage: blender --background [source.blend] --python tools/blender-export-runtime.py -- <mode> <input-or-dash> <output.glb> <max-texture>")

mode, source, output, max_texture_s = args[:4]
max_texture = int(max_texture_s)

if mode != "blend":
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if mode == "gltf":
        result = bpy.ops.import_scene.gltf(filepath=source)
    elif mode == "fbx":
        result = bpy.ops.import_scene.fbx(filepath=source)
    else:
        raise RuntimeError(f"unsupported import mode: {mode}")
    if "FINISHED" not in result:
        raise RuntimeError(f"import failed for {source}: {result}")

# Runtime delivery needs bounded textures. Resize only working copies inside
# Blender; the preserved source archive is never modified.
for image in bpy.data.images:
    width, height = image.size[:]
    if width <= 0 or height <= 0 or max(width, height) <= max_texture:
        continue
    scale = max_texture / max(width, height)
    new_width = max(1, round(width * scale))
    new_height = max(1, round(height * scale))
    image.scale(new_width, new_height)

os.makedirs(os.path.dirname(output), exist_ok=True)
result = bpy.ops.export_scene.gltf(
    filepath=output,
    export_format="GLB",
    export_yup=True,
)
if "FINISHED" not in result:
    raise RuntimeError(f"glTF export failed for {source}: {result}")
if not os.path.isfile(output) or os.path.getsize(output) <= 20:
    raise RuntimeError(f"glTF export did not produce a usable file: {output}")

print(f"RUNTIME_GLb_OK source={source} output={output} bytes={os.path.getsize(output)} max_texture={max_texture}")
