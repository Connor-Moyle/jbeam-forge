# JBeam Forge for Blender
#
# Names your meshes the way JBeam Forge reads them (car_door_FL, car_bumper_race_F…) and exports
# the model for it. Point JBeam Forge at the exported file once (File → Import): after that, every
# export from here is picked up by the app straight away, with your parts kept.
#
# Install: Blender → Edit → Preferences → Add-ons → Install… → pick this file → tick it.
# Then: 3D view → N panel → JBeam Forge.

bl_info = {
    "name": "JBeam Forge",
    "author": "Connor Moyle",
    "version": (0, 16, 0),
    "blender": (3, 6, 0),
    "location": "3D View > Sidebar > JBeam Forge",
    "description": "Name meshes for JBeam Forge and export them for it, live",
    "category": "Import-Export",
}

import os

import bpy
from bpy.app.handlers import persistent

# The part types JBeam Forge knows (its taxonomy): id, label, category.
# Made by `node scripts/dev/blender-addon-types.mjs`; a test keeps it in step with the app.
# BEGIN TYPES
TYPES = [
    ("body", "Body shell", "Body & Structure"),
    ("frame", "Chassis frame", "Body & Structure"),
    ("roof", "Roof", "Body & Structure"),
    ("firewall", "Firewall", "Body & Structure"),
    ("radiator_support", "Radiator support", "Body & Structure"),
    ("floor", "Floor pan", "Body & Structure"),
    ("subframe", "Subframe", "Body & Structure"),
    ("engine_bay", "Engine bay", "Body & Structure"),
    ("inner_fender", "Inner fender liner", "Body & Structure"),
    ("rollcage", "Roll cage", "Body & Structure"),
    ("rollbar", "Roll bar (half cage)", "Body & Structure"),
    ("exocage", "Exterior cage", "Body & Structure"),
    ("chassis_brace", "Chassis brace", "Body & Structure"),
    ("hood", "Hood", "Panels"),
    ("trunk", "Trunk lid", "Panels"),
    ("tailgate", "Tailgate", "Panels"),
    ("door", "Door", "Panels"),
    ("sliding_door", "Sliding door", "Panels"),
    ("fender", "Fender", "Panels"),
    ("quarter_panel", "Quarter panel", "Panels"),
    ("fender_flare", "Fender flare", "Panels"),
    ("side_skirt", "Side skirt", "Panels"),
    ("fuel_door", "Fuel filler door", "Panels"),
    ("bed", "Truck bed", "Panels"),
    ("cab", "Cab", "Panels"),
    ("bumper", "Bumper", "Bumpers & Aero"),
    ("bumper_reinforcement", "Bumper reinforcement", "Bumpers & Aero"),
    ("bull_bar", "Bull bar", "Bumpers & Aero"),
    ("splitter", "Splitter", "Bumpers & Aero"),
    ("lip", "Lip spoiler", "Bumpers & Aero"),
    ("diffuser", "Diffuser", "Bumpers & Aero"),
    ("wing", "Rear wing", "Bumpers & Aero"),
    ("spoiler", "Spoiler", "Bumpers & Aero"),
    ("canard", "Canard", "Bumpers & Aero"),
    ("mudflap", "Mud flap", "Bumpers & Aero"),
    ("skidplate", "Skid plate", "Bumpers & Aero"),
    ("tow_hook", "Tow hook", "Bumpers & Aero"),
    ("tow_hitch", "Tow hitch", "Bumpers & Aero"),
    ("roof_scoop", "Roof scoop", "Bumpers & Aero"),
    ("hood_scoop", "Hood scoop", "Bumpers & Aero"),
    ("headlight", "Headlight", "Lights"),
    ("taillight", "Taillight", "Lights"),
    ("foglight", "Fog light", "Lights"),
    ("indicator", "Indicator", "Lights"),
    ("reverse_light", "Reverse light", "Lights"),
    ("brake_light", "Third brake light", "Lights"),
    ("underglow", "Underglow", "Lights"),
    ("plate_light", "License plate light", "Lights"),
    ("light_bar", "Light bar", "Lights"),
    ("police_lights", "Emergency lights", "Lights"),
    ("windshield", "Windshield", "Glass"),
    ("rear_window", "Rear window", "Glass"),
    ("door_glass", "Door glass", "Glass"),
    ("quarter_glass", "Quarter glass", "Glass"),
    ("sunroof", "Sunroof", "Glass"),
    ("tailgate_glass", "Tailgate glass", "Glass"),
    ("grille", "Grille", "Exterior Trim"),
    ("mirror", "Side mirror", "Exterior Trim"),
    ("door_handle", "Door handle", "Exterior Trim"),
    ("wiper", "Wiper", "Exterior Trim"),
    ("rear_wiper", "Rear wiper", "Exterior Trim"),
    ("badge", "Badge", "Exterior Trim"),
    ("antenna", "Antenna", "Exterior Trim"),
    ("roof_rack", "Roof rack", "Exterior Trim"),
    ("snorkel", "Snorkel", "Exterior Trim"),
    ("sunstrip", "Sun strip", "Exterior Trim"),
    ("trim", "Trim piece", "Exterior Trim"),
    ("spare_wheel_carrier", "Spare wheel carrier", "Exterior Trim"),
    ("cargo", "Cargo / load", "Exterior Trim"),
    ("dashboard", "Dashboard", "Interior"),
    ("gauges", "Gauge cluster", "Interior"),
    ("center_console", "Center console", "Interior"),
    ("radio", "Radio / head unit", "Interior"),
    ("steering_wheel", "Steering wheel", "Interior"),
    ("steering_column", "Steering column", "Interior"),
    ("shifter", "Shifter", "Interior"),
    ("handbrake", "Handbrake", "Interior"),
    ("pedals", "Pedals", "Interior"),
    ("seat", "Seat", "Interior"),
    ("rear_seat", "Rear bench", "Interior"),
    ("seatbelt", "Seat belt", "Interior"),
    ("door_card", "Door card", "Interior"),
    ("window_switch", "Window switch", "Interior"),
    ("headliner", "Headliner", "Interior"),
    ("interior_mirror", "Interior mirror", "Interior"),
    ("carpet", "Carpet", "Interior"),
    ("parcel_shelf", "Parcel shelf", "Interior"),
    ("trunk_trim", "Trunk trim", "Interior"),
    ("interior_trim", "Interior trim", "Interior"),
    ("engine", "Engine", "Mechanical"),
    ("intake", "Intake", "Mechanical"),
    ("turbo", "Turbocharger", "Mechanical"),
    ("supercharger", "Supercharger", "Mechanical"),
    ("engine_cover", "Engine cover", "Mechanical"),
    ("engine_mount", "Engine mount", "Mechanical"),
    ("exhaust_manifold", "Exhaust manifold", "Mechanical"),
    ("exhaust", "Exhaust", "Mechanical"),
    ("muffler", "Muffler", "Mechanical"),
    ("radiator", "Radiator", "Mechanical"),
    ("intercooler", "Intercooler", "Mechanical"),
    ("oil_cooler", "Oil cooler", "Mechanical"),
    ("fuel_tank", "Fuel tank", "Mechanical"),
    ("nitrous", "Nitrous bottle", "Mechanical"),
    ("battery", "Battery", "Mechanical"),
    ("washer_tank", "Washer tank", "Mechanical"),
    ("transmission", "Transmission", "Mechanical"),
    ("transfer_case", "Transfer case", "Mechanical"),
    ("driveshaft", "Driveshaft", "Mechanical"),
    ("differential", "Differential", "Mechanical"),
    ("halfshaft", "Halfshaft", "Mechanical"),
    ("axle", "Solid axle", "Mechanical"),
    ("strut", "Strut", "Mechanical"),
    ("coilover", "Coilover", "Mechanical"),
    ("spring", "Spring", "Mechanical"),
    ("lower_arm", "Lower control arm", "Mechanical"),
    ("upper_arm", "Upper control arm", "Mechanical"),
    ("trailing_arm", "Trailing arm", "Mechanical"),
    ("link", "Suspension link", "Mechanical"),
    ("sway_bar", "Anti-roll bar", "Mechanical"),
    ("hub", "Hub", "Mechanical"),
    ("knuckle", "Knuckle", "Mechanical"),
    ("tie_rod", "Tie rod", "Mechanical"),
    ("steering_rack", "Steering rack", "Mechanical"),
    ("wheel", "Wheel", "Mechanical"),
    ("tire", "Tire", "Mechanical"),
    ("spare_wheel", "Spare wheel", "Mechanical"),
    ("brake_disc", "Brake disc", "Mechanical"),
    ("brake_caliper", "Brake caliper", "Mechanical"),
    ("brake_drum", "Brake drum", "Mechanical"),
    ("license_plate", "License plate", "Misc"),
    ("police_equipment", "Police equipment", "Misc"),
    ("custom", "Custom part", "Misc"),
]
# END TYPES

POSITIONS = [
    ("NONE", "None", "No position"),
    ("F", "Front", ""),
    ("R", "Rear", ""),
    ("L", "Left", ""),
    ("RH", "Right", "Written as R on left/right parts"),
    ("FL", "Front left", ""),
    ("FR", "Front right", ""),
    ("RL", "Rear left", ""),
    ("RR", "Rear right", ""),
]


def type_items(self, context):
    return [(t[0], t[1], t[2]) for t in TYPES]


def part_name(settings, index=0):
    """car_type_position_variant; the second piece onwards gets a number glued on (door_FL2), which
    JBeam Forge reads as another piece of the same part (a separate _2 would make a variant)."""
    bits = [settings.prefix.strip(), settings.part_type]
    if settings.position == "RH":
        bits.append("R")
    elif settings.position != "NONE":
        bits.append(settings.position)
    if settings.variant.strip():
        bits.append(settings.variant.strip().replace(" ", "_"))
    name = "_".join(b for b in bits if b)
    return name if index == 0 else f"{name}{index + 1}"


class JBeamForgeSettings(bpy.types.PropertyGroup):
    prefix: bpy.props.StringProperty(name="Car", description="Your car's short name, first in every mesh name", default="mycar")
    part_type: bpy.props.EnumProperty(name="Part", description="What the selected meshes are", items=type_items)
    position: bpy.props.EnumProperty(name="Position", items=POSITIONS, default="NONE")
    variant: bpy.props.StringProperty(name="Variant", description="race, widebody, a, b… (leave empty for the standard part)")
    export_path: bpy.props.StringProperty(name="File", description="The model JBeam Forge imports (.glb)", subtype="FILE_PATH", default="//jbeam_forge.glb")
    export_on_save: bpy.props.BoolProperty(name="Export when I save", description="Export every time the .blend is saved, so JBeam Forge updates by itself", default=True)
    selected_only: bpy.props.BoolProperty(name="Selected only", default=False)


class JBEAMFORGE_OT_name(bpy.types.Operator):
    """Name the selected meshes as this part"""

    bl_idname = "jbeam_forge.name_selected"
    bl_label = "Name selected"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        s = context.scene.jbeam_forge
        meshes = [o for o in context.selected_objects if o.type == "MESH"]
        if not meshes:
            self.report({"WARNING"}, "Select the meshes to name first")
            return {"CANCELLED"}
        for i, obj in enumerate(sorted(meshes, key=lambda o: o.name)):
            obj.name = part_name(s, i)
        self.report({"INFO"}, f"Named {len(meshes)} as {part_name(s)}")
        return {"FINISHED"}


def export_model(scene, report=None):
    s = scene.jbeam_forge
    path = bpy.path.abspath(s.export_path)
    if not path.lower().endswith((".glb", ".gltf")):
        path += ".glb"
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB" if path.lower().endswith(".glb") else "GLTF_SEPARATE", use_selection=s.selected_only, export_apply=True, export_yup=True)
    if report:
        report({"INFO"}, f"Exported for JBeam Forge: {path}")
    return path


class JBEAMFORGE_OT_export(bpy.types.Operator):
    """Export the model for JBeam Forge (it updates by itself once imported)"""

    bl_idname = "jbeam_forge.export"
    bl_label = "Export for JBeam Forge"

    def execute(self, context):
        if not bpy.data.filepath and bpy.path.abspath(context.scene.jbeam_forge.export_path).startswith("//"):
            self.report({"WARNING"}, "Save the .blend first, or give the file a full path")
            return {"CANCELLED"}
        export_model(context.scene, self.report)
        return {"FINISHED"}


class JBEAMFORGE_PT_panel(bpy.types.Panel):
    bl_label = "JBeam Forge"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "JBeam Forge"

    def draw(self, context):
        s = context.scene.jbeam_forge
        col = self.layout.column()
        col.label(text="Name parts")
        col.prop(s, "prefix")
        col.prop(s, "part_type")
        col.prop(s, "position")
        col.prop(s, "variant")
        col.label(text=f"→ {part_name(s)}")
        col.operator(JBEAMFORGE_OT_name.bl_idname)
        col.separator()
        col.label(text="Export")
        col.prop(s, "export_path")
        col.prop(s, "selected_only")
        col.prop(s, "export_on_save")
        col.operator(JBEAMFORGE_OT_export.bl_idname, icon="EXPORT")


@persistent
def export_after_save(_dummy):
    scene = bpy.context.scene
    if getattr(scene, "jbeam_forge", None) and scene.jbeam_forge.export_on_save:
        try:
            export_model(scene)
        except Exception as err:  # never let a failed export get in the way of saving
            print(f"JBeam Forge: export after save failed: {err}")


CLASSES = (JBeamForgeSettings, JBEAMFORGE_OT_name, JBEAMFORGE_OT_export, JBEAMFORGE_PT_panel)


def register():
    for c in CLASSES:
        bpy.utils.register_class(c)
    bpy.types.Scene.jbeam_forge = bpy.props.PointerProperty(type=JBeamForgeSettings)
    bpy.app.handlers.save_post.append(export_after_save)


def unregister():
    if export_after_save in bpy.app.handlers.save_post:
        bpy.app.handlers.save_post.remove(export_after_save)
    del bpy.types.Scene.jbeam_forge
    for c in reversed(CLASSES):
        bpy.utils.unregister_class(c)


if __name__ == "__main__":
    register()
