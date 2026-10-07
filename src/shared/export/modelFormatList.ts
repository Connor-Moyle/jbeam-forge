/** The file formats a model can be exported as (File → Export Model). */
export const MODEL_FORMAT_VALUES = ['glb', 'gltf', 'fbx', 'dae', 'obj', 'stl', 'ply'] as const;
export type ModelFormat = (typeof MODEL_FORMAT_VALUES)[number];

export interface ModelFormatInfo {
  value: ModelFormat;
  /** As the menu and the save dialog name it. */
  label: string;
  short: string;
  /** What it carries and what it's for, in a line. */
  note: string;
}

export const MODEL_FORMATS: readonly ModelFormatInfo[] = [
  { value: 'glb', label: 'glTF binary (.glb)', short: 'glTF', note: 'One file with materials and textures. The best way into Blender, and what web viewers read.' },
  { value: 'gltf', label: 'glTF (.gltf)', short: 'glTF', note: 'The same as readable text, with its textures inside it.' },
  { value: 'fbx', label: 'Autodesk FBX (.fbx)', short: 'FBX', note: 'For Maya, 3ds Max, Unity, Unreal and Blender. Meshes, normals, UVs and material colours (no textures).' },
  { value: 'dae', label: 'COLLADA (.dae)', short: 'COLLADA', note: 'Z up, in metres, as BeamNG reads it: ready to use in a mod made by hand.' },
  { value: 'obj', label: 'Wavefront OBJ (.obj + .mtl)', short: 'OBJ', note: 'Read by almost everything. Meshes, normals, UVs and material colours in a .mtl beside it.' },
  { value: 'stl', label: 'STL (.stl)', short: 'STL', note: 'The shape alone, for 3D printing and slicers: no names, materials or UVs.' },
  { value: 'ply', label: 'Stanford PLY (.ply)', short: 'PLY', note: 'One mesh with normals and a colour per vertex, for scan and point-cloud tools.' },
];
