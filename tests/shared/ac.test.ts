import { describe, expect, it } from 'vitest';
import { acdKey, iniNumber, parseIni, parseLut, readAcd, readAcdTrying } from '@shared/ac/files';
import { parseUiJson, summarizeAcCar } from '@shared/ac/car';

/** Pack files the way data.acd stores them (each byte in a 32-bit slot, shifted by the key). */
function packAcd(files: Record<string, string>, folder: string, withHeader = false): Uint8Array {
  const key = [...acdKey(folder)].map((c) => c.charCodeAt(0));
  const out: number[] = [];
  const i32 = (v: number) => {
    const b = new DataView(new ArrayBuffer(4));
    b.setInt32(0, v, true);
    out.push(...new Uint8Array(b.buffer));
  };
  if (withHeader) {
    i32(-1111);
    i32(0);
  }
  for (const [name, text] of Object.entries(files)) {
    i32(name.length);
    out.push(...[...name].map((c) => c.charCodeAt(0)));
    const data = new TextEncoder().encode(text);
    i32(data.length);
    data.forEach((b, i) => out.push((b + key[i % key.length]!) & 0xff, 0, 0, 0));
  }
  return new Uint8Array(out);
}

const CAR_FILES: Record<string, string> = {
  'data/car.ini': '[HEADER]\nVERSION=2\n[INFO]\nSCREEN_NAME=Test Coupe\n[BASIC]\nTOTALMASS=1180 ; kg with driver\n[FUEL]\nMAX_FUEL=55\n[CONTROLS]\nSTEER_LOCK=450\nSTEER_RATIO=16',
  'data/suspensions.ini': '[BASIC]\nWHEELBASE=2.55\nCG_LOCATION=0.56\n[FRONT]\nTYPE=STRUT\nTRACK=1.48\n[REAR]\nTYPE=DWB\nTRACK=1.50',
  'data/tyres.ini': '[FRONT]\nNAME=Street\nWIDTH=0.225\nRADIUS=0.315\nRIM_RADIUS=0.2286\n[REAR]\nNAME=Street\nWIDTH=0.245\nRADIUS=0.32\nRIM_RADIUS=0.2286',
  'data/engine.ini': '[HEADER]\nPOWER_CURVE=power.lut\n[ENGINE_DATA]\nMINIMUM=900\nLIMITER=7000\n[TURBO_0]\nMAX_BOOST=0.8',
  'data/power.lut': '1000|200\n4000|300\n6500|250\n8000|240 ; past the limiter\n',
  'data/drivetrain.ini': '[TRACTION]\nTYPE=RWD\n[GEARS]\nCOUNT=3\nGEAR_R=-3.5\nGEAR_1=3.2\nGEAR_2=1.9\nGEAR_3=1.3\nFINAL=3.9\n[DIFFERENTIAL]\nPOWER=0.4\nCOAST=0.2',
  'data/brakes.ini': '[DATA]\nMAX_TORQUE=2200\nFRONT_SHARE=0.66',
  'ui/ui_car.json': '﻿{\n "name": "Test Coupe",\n "brand": "Testmaker",\n "description": "Line one<br>Line\ttwo\n raw newline",\n "tags": ["rwd", "turbo",],\n "year": "1994",\n "author": "Someone",\n}',
  'extension/ext_config.ini': '[LIGHT_HEADLIGHT_0]\nCOLOR=1,1,1',
};

describe('Assetto Corsa files', () => {
  it('reads INI with comments, odd spacing and case', () => {
    const ini = parseIni('; top comment\n[Header]\nversion = 3 // note\n\n[info]\nScreen_Name=My Car ; name\nbroken line\n');
    expect(ini).toEqual({ HEADER: { VERSION: '3' }, INFO: { SCREEN_NAME: 'My Car' } });
    expect(iniNumber(ini, 'header', 'version')).toBe(3);
    expect(iniNumber(ini, 'info', 'screen_name')).toBeNull();
  });

  it('reads LUT curves, skipping junk', () => {
    expect(parseLut('0|10\n; comment\n1000 | 20.5\nnot a row\n2000|x')).toEqual([
      [0, 10],
      [1000, 20.5],
    ]);
  });

  it('makes the data.acd key the game uses', () => {
    expect(acdKey('abarth500')).toBe('7-248-6-221-246-250-21-49');
    expect(acdKey('ks_mazda_mx5_cup')).toBe('106-202-176-132-70-160-64-113');
    expect(acdKey('KS_Mazda_MX5_Cup')).toBe(acdKey('ks_mazda_mx5_cup'));
  });

  it('unpacks data.acd, with or without the newer header', () => {
    const files = { 'car.ini': '[HEADER]\nVERSION=1', 'power.lut': '1000|100' };
    for (const header of [false, true]) {
      const out = readAcd(packAcd(files, 'my_car', header), 'my_car');
      expect(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, new TextDecoder().decode(v)]))).toEqual(files);
    }
  });

  it('refuses data.acd packed for another folder name', () => {
    expect(() => readAcd(packAcd({ 'car.ini': '[HEADER]\nVERSION=1' }, 'my_car'), 'renamed_car')).toThrow(/folder name/);
  });

  it('finds the name data.acd was packed under when the folder was renamed', () => {
    const packed = packAcd({ 'car.ini': '[HEADER]\nVERSION=1' }, 'my_car');
    const { files, folderName } = readAcdTrying(packed, ['My Car v2', 'my_car_old', 'my_car']);
    expect(folderName).toBe('my_car');
    expect(new TextDecoder().decode(files['car.ini'])).toContain('[HEADER]');
    expect(() => readAcdTrying(packed, ['nope'])).toThrow(/folder name/);
  });

  it('reads ui_car.json the way the game writes it', () => {
    const ui = parseUiJson(CAR_FILES['ui/ui_car.json']!);
    expect(ui?.name).toBe('Test Coupe');
    expect(ui?.tags).toEqual(['rwd', 'turbo']);
    expect(parseUiJson('not json')).toBeNull();
  });

  it('summarises a car from its files', () => {
    const s = summarizeAcCar(CAR_FILES);
    expect(s).toMatchObject({
      name: 'Test Coupe',
      brand: 'Testmaker',
      year: 1994,
      author: 'Someone',
      tags: ['rwd', 'turbo'],
      massKg: 1180,
      maxFuelL: 55,
      wheelbase: 2.55,
      frontWeight: 0.56,
      trackFront: 1.48,
      trackRear: 1.5,
      suspensionFront: 'MacPherson strut',
      suspensionRear: 'Double wishbone',
      tyresFront: { name: 'Street', width: 0.225, radius: 0.315, rimRadius: 0.2286 },
      brakes: { maxTorque: 2200, frontShare: 0.66 },
      steering: { lock: 450, ratio: 16 },
      fileCount: { data: 7, extension: 1, ui: 1 },
    });
    expect(s.description).toBe('Line one\nLine\ttwo\n raw newline');
    expect(s.engine).toMatchObject({ idle: 900, limiter: 7000, turbo: true, peakTorque: { nm: 300, rpm: 4000 } });
    // 8000 rpm is past the limiter, so the peak is at 6500 (250 Nm ≈ 170 kW).
    expect(s.engine.peakPower?.rpm).toBe(6500);
    expect(s.engine.peakPower?.kw).toBeCloseTo((250 * 6500 * 2 * Math.PI) / 60000);
    expect(s.drivetrain).toEqual({ layout: 'RWD', gears: [3.2, 1.9, 1.3], reverse: -3.5, finalDrive: 3.9, diffPower: 0.4, diffCoast: 0.2 });
  });

  it('copes with a car that has no data at all', () => {
    const s = summarizeAcCar({});
    expect(s.name).toBeNull();
    expect(s.engine.torqueCurve).toEqual([]);
    expect(s.drivetrain.gears).toEqual([]);
  });
});
