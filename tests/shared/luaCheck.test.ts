import { describe, expect, it } from 'vitest';
import { checkLua } from '../../src/shared/lua/check';

const codes = (src: string, controller = true) => checkLua(src, { controller }).diagnostics.map((d) => `${d.severity}:${d.code}@${d.line}`);

describe('Lua checker', () => {
  it('passes a clean controller and lists its hooks', () => {
    const src = `local M = {}
local angle = 0
local function init(jbeamData)
  angle = jbeamData.start or 0
end
local function updateGFX(dt)
  angle = angle + dt * 90
  electrics.values.myWiper = clamp(angle, 0, 90)
  if obj:getVelocity():length() > 10 then log("I", "wiper", "fast") end
end
M.init = init
M.updateGFX = updateGFX
return M
`;
    const r = checkLua(src, { controller: true });
    expect(r.diagnostics).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.hooks.sort()).toEqual(['init', 'updateGFX']);
  });

  it('explains syntax slips from other languages', () => {
    const r = checkLua('local x = 1\nx += 2\nreturn x', { controller: true });
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]).toMatchObject({ severity: 'error', code: 'syntax', line: 2 });
    expect(r.diagnostics[0]!.message).toMatch(/no \+= or -=/);
    expect(checkLua('if a != b then end').diagnostics[0]!.message).toMatch(/~=/);
    expect(checkLua('// hello').diagnostics[0]!.message).toMatch(/--/);
  });

  it('finds undefined names, missing locals, unused locals and dots for colons', () => {
    const src = `local M = {}
local unused = 5
function M.updateGFX(dt)
  speed = electrics.values.wheelspeed
  electrics.wiper = 1
  obj.playSFX(3)
  electrics.values.x = speeed
end
return M`;
    expect(codes(src)).toEqual(['info:unused@2', 'warning:global@4', 'warning:electrics@5', 'warning:colon@6', 'warning:undefined@7']);
  });

  it('insists on return M and hooks the game calls', () => {
    expect(codes('local M = {}\nM.updateGfx = function(dt) end\n')).toContain('error:no-return@2');
    expect(codes('local M = {}\nM.updategfx = function(dt) end\nreturn M')).toEqual(['warning:hook-case@2', 'warning:no-hooks@3']);
    expect(codes('local M = { updateGFX = function(dt) end }\nreturn M')).toEqual([]);
    expect(codes('local M = {}\nfunction M.update(dt) end\nreturn M')).toEqual(['info:update-rate@3']);
  });

  it('rejects what vehicle Lua doesn’t have', () => {
    expect(codes('os.execute("x")', false)).toEqual(['error:unavailable@1']);
    expect(checkLua('os.execute("x")').ok).toBe(false);
  });

  it('knows scopes: loops, blocks, params and upvalues', () => {
    const src = `local M = {}
local t = {1, 2}
for i, v in ipairs(t) do print(i, v) end
for k = 1, 3 do print(k) end
do local inner = 1 print(inner) end
print(inner)
local function f(a, b) return a end
M.init = function(jbeamData) f(1) end
return M`;
    expect(codes(src)).toEqual(['warning:undefined@6']);
  });

  it('knows self in functions declared with a colon', () => {
    expect(codes('local M = {}\nfunction M:updateGFX(dt) self.x = dt end\nreturn M')).toEqual([]);
  });
});
