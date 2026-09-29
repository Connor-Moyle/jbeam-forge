/** The parts of fengari (Lua 5.3 in JavaScript) the script test runner uses. */
declare module 'fengari' {
  export type LuaState = { readonly __luaState: unique symbol };
  export const lua: {
    LUA_OK: number;
    lua_pcall(L: LuaState, nargs: number, nresults: number, msgh: number): number;
    lua_tostring(L: LuaState, index: number): Uint8Array;
    lua_close(L: LuaState): void;
  };
  export const lauxlib: {
    luaL_newstate(): LuaState;
    luaL_loadstring(L: LuaState, source: Uint8Array): number;
  };
  export const lualib: { luaL_openlibs(L: LuaState): void };
  export function to_luastring(s: string): Uint8Array;
  export function to_jsstring(s: Uint8Array): string;
}
