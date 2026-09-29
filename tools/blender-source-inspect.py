import bpy
import json
import os
import sys

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(args) != 2:
    raise SystemExit("usage: blender --background <file.blend> --python tools/blender-source-inspect.py -- <label> <output.json>")

label, output = args
payload = {
    "label": label,
    "sourceFile": bpy.data.filepath,
    "objects": [],
    "armatures": [],
    "actions": [],
    "images": [],
}

for obj in bpy.data.objects:
    payload["objects"].append({
        "name": obj.name,
        "type": obj.type,
        "parent": obj.parent.name if obj.parent else None,
        "dimensions": [round(float(v), 6) for v in obj.dimensions],
    })
    if obj.type == "ARMATURE":
        payload["armatures"].append({
            "name": obj.name,
            "bones": [bone.name for bone in obj.data.bones],
        })

for action in bpy.data.actions:
    payload["actions"].append({
        "name": action.name,
        "frameRange": [float(action.frame_range[0]), float(action.frame_range[1])],
        "fcurves": len(action.fcurves),
    })

for image in bpy.data.images:
    payload["images"].append({
        "name": image.name,
        "size": list(image.size[:]),
        "packed": bool(image.packed_file),
        "filepath": image.filepath,
    })

payload["objects"].sort(key=lambda x: (x["type"], x["name"]))
payload["armatures"].sort(key=lambda x: x["name"])
payload["actions"].sort(key=lambda x: x["name"])
payload["images"].sort(key=lambda x: x["name"])

os.makedirs(os.path.dirname(output), exist_ok=True)
with open(output, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, indent=2)
    handle.write("\n")

print(json.dumps({
    "label": label,
    "objects": len(payload["objects"]),
    "armatures": len(payload["armatures"]),
    "actions": [a["name"] for a in payload["actions"]],
    "images": len(payload["images"]),
}, indent=2))
