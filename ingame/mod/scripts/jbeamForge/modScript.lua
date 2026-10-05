-- Loads JBeam Forge's game side when the mod is mounted, and keeps it loaded across maps,
-- so F10 works from the first frame.
extensions.load('jbeamForge')
setExtensionUnloadMode('jbeamForge', 'manual')
