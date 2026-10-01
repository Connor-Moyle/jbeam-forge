import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASSET_CREDITS, creditLine, creditsForSources, creditsText } from '../../src/shared/credits';

describe('credits', () => {
  const car = ASSET_CREDITS.find((c) => c.title === '1982 BMW 3 Series E30')!;

  it('credit the practice car as CC BY asks: title, author, source, licence, changes', () => {
    const line = creditLine(car);
    for (const part of ['1982 BMW 3 Series E30', 'zairiq-zairiq-123-pixar-cars-bfdi', 'sketchfab.com/3d-models/1982-bmw-3-series-e30', 'CC BY 4.0', 'creativecommons.org/licenses/by/4.0', 'Changes:']) expect(line).toContain(part);
  });

  it('ship with the car, in the same words', () => {
    const shipped = readFileSync(join(__dirname, '..', '..', 'assets', 'demo-car', 'CREDITS.txt'), 'utf8');
    expect(shipped).toContain(creditLine(car));
  });

  it('go with a mod made from the practice car, on any system, and not with other models', () => {
    expect(creditsForSources(['C:\\Users\\me\\AppData\\Roaming\\JBeam Forge\\tutorial\\demo_car.obj'])).toEqual([car]);
    expect(creditsForSources(['/home/me/.config/jbeam-forge/tutorial/demo_car.obj'])).toEqual([car]);
    expect(creditsForSources(['/home/me/models/my_car.obj'])).toEqual([]);
    expect(creditsText([car], 'My E30')).toContain('zairiq-zairiq-123-pixar-cars-bfdi');
  });
});
