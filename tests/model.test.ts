import { describe, expect, it } from 'vitest';
import { History, constrain, feedbackText, fitScale, nextPin, type Annotation } from '../src/model';
const annotation = (id: string, number?: number): Annotation => ({ id, type: number ? 'pin' : 'pen', points: [{ x: 10, y: 10 }], color: '#fff', size: 4, number, text: `Note ${id}` });
describe('annotation history', () => {
  it('undoes and redoes edits without changing earlier annotations', () => {
    const history = new History(), first = annotation('a');
    history.commit([first]); history.commit([first, annotation('b')]);
    history.undo(); expect(history.items).toEqual([first]);
    history.redo(); expect(history.items).toHaveLength(2);
    expect(history.items[0]).toBe(first);
  });
  it('invalidates redo when a new edit branches from an undo', () => {
    const history = new History(); history.commit([annotation('a')]); history.undo();
    history.commit([annotation('b')]); history.redo();
    expect(history.items[0].id).toBe('b'); expect(history.canRedo).toBe(false);
  });
  it('clears old history on image replacement', () => {
    const history = new History(); history.commit([annotation('a')]); history.reset([annotation('restored')]);
    expect(history.canUndo).toBe(false); expect(history.canRedo).toBe(false);
    expect(history.items[0].id).toBe('restored');
  });
  it('bounds history while retaining current content', () => {
    const history = new History();
    for (let n = 0; n < 200; n++) history.commit([...history.items, annotation(String(n))]);
    for (let n = 0; n < 200; n++) history.undo();
    expect(history.items).toHaveLength(50);
  });
});
it('snaps arrows to 45 degrees while retaining length', () => {
  const point = constrain({ x: 0, y: 0 }, { x: 100, y: 10 });
  expect(point.y).toBeCloseTo(0); expect(point.x).toBeCloseTo(Math.hypot(100, 10));
});
it('fits large images and never enlarges small ones', () => {
  expect(fitScale(4000, 2000, 1096, 596)).toBe(.25);
  expect(fitScale(100, 100, 1000, 1000)).toBe(1);
});
it('keeps pin numbers unique after deletion and produces matching handoff text', () => {
  const items = [annotation('a', 1), annotation('c', 3), annotation('drawing')];
  expect(nextPin(items)).toBe(4); expect(feedbackText(items)).toBe('1. Note a\n3. Note c');
});

import { hitPin, movePin, pinRadius, resizePin } from '../src/model';
import { moveAnnotation, resizeAnnotation } from '../src/model';
import { layoutSheet, wrapText } from '../src/notes-sheet';
it('moves and resizes legacy markers without mutating history or renumbering', () => {
  const pin = annotation('a', 7), history = new History();
  history.reset([pin]);
  expect(pinRadius(pin)).toBe(14);
  history.commit([movePin(pin, { x: 300, y: -40 }, 200, 100)]);
  expect(history.items[0].points[0]).toEqual({ x: 200, y: 0 });
  history.commit([resizePin(history.items[0], 40)]);
  expect(history.items[0].number).toBe(7);
  expect(pinRadius(history.items[0])).toBe(40);
  history.undo(); expect(pinRadius(history.items[0])).toBe(14);
  history.undo(); expect(history.items[0]).toBe(pin);
  expect(pin.points[0]).toEqual({ x: 10, y: 10 });
  expect(pinRadius(resizePin(pin, 1000))).toBe(96);
  expect(pinRadius(resizePin(pin, 0))).toBe(8);
});
it('hits the topmost marker at its resized radius and ignores other marks', () => {
  const a = annotation('a', 1), b = resizePin(annotation('b', 2), 40);
  expect(hitPin([a, b, annotation('stroke')], { x: 45, y: 10 }, 1)?.id).toBe('b');
  expect(hitPin([a], { x: 45, y: 10 }, 1)).toBeUndefined();
  expect(hitPin([b], { x: 48, y: 48 }, 1)?.id).toBe('b'); // Square corners are clickable.
});
it('resizes reversed boxes through the opposite corner and keeps movement on the image', () => {
  const box: Annotation = { ...annotation('box'), type: 'rectangle', points: [{ x: 50, y: 50 }, { x: 30, y: 30 }] };
  const ctx = {} as CanvasRenderingContext2D; // Box/arrow geometry does not measure text.
  const resized = resizeAnnotation(box, 'nw', { x: 30, y: 30 }, ctx, 100, 100);
  expect(resized.points).toEqual([{ x: 50, y: 50 }, { x: 60, y: 60 }]);
  expect(moveAnnotation(resized, { x: 100, y: -100 }, 100, 100, ctx).points).toEqual([{ x: 90, y: 0 }, { x: 100, y: 10 }]);
  expect(box.points).toEqual([{ x: 50, y: 50 }, { x: 30, y: 30 }]);
  expect(resizeAnnotation(box, 'se', { x: 0, y: 0 }, ctx, 100, 100)).toBe(box);
});
it('edits either arrow endpoint while keeping the opposite endpoint fixed', () => {
  const arrow: Annotation = { ...annotation('arrow'), type: 'arrow', points: [{ x: 20, y: 20 }, { x: 80, y: 80 }] };
  const ctx = {} as CanvasRenderingContext2D;
  expect(resizeAnnotation(arrow, 'start', { x: -50, y: 10 }, ctx, 100, 100).points).toEqual([{ x: 0, y: 30 }, { x: 80, y: 80 }]);
  expect(resizeAnnotation(arrow, 'end', { x: 50, y: -10 }, ctx, 100, 100).points).toEqual([{ x: 20, y: 20 }, { x: 100, y: 70 }]);
});
it('wraps all feedback including paragraphs and long unbroken words', () => {
  const measure = (text: string) => Array.from(text).length;
  const text = 'A readable sentence.\n\n' + 'x'.repeat(250) + '\n日本語のフィードバック';
  const lines = wrapText(text, 24, measure);
  expect(lines.every(line => measure(line) <= 24)).toBe(true);
  expect(lines.join('').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''));
  expect(lines).toContain('');
});
it('lays out every note without clipping and retains gaps in numbering', () => {
  const items = [annotation('three', 3), { ...annotation('one', 1), text: 'A long note '.repeat(120) }];
  const sheet = layoutSheet(1000, 700, items, text => text.length * 10);
  expect(sheet.width).toBe(1500);
  expect(sheet.imageScale).toBe(1);
  expect(sheet.rows.map(row => row.note.number)).toEqual([1, 3]);
  expect(sheet.height).toBeGreaterThan(sheet.rows.at(-1)!.y + sheet.rows.at(-1)!.height);
  expect(sheet.rows[1].y).toBe(sheet.rows[0].y + sheet.rows[0].height);
  const large = layoutSheet(8000, 5000, items, text => text.length * 10);
  expect(large.imageWidth).toBe(4096);
  expect(large.imageHeight).toBe(2560);
  expect(large.fontSize * 1000 / large.width).toBeGreaterThanOrEqual(18);
  expect(sheet.fontSize).toBeGreaterThanOrEqual(28);
  expect(large.fontSize).toBeGreaterThan(sheet.fontSize * 3);
  expect(() => layoutSheet(100, 100, [], text => text.length)).toThrow('Add a numbered');
  expect(() => layoutSheet(1000, 700, [{ ...annotation('huge', 1), text: '\n'.repeat(2000) }], text => text.length)).toThrow('no notes have been omitted');
});
