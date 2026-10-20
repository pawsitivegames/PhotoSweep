import { afterEach, describe, expect, it, vi } from 'vitest';
import getFormData from '../src/ui/logic/utils/getFormData';

describe('getFormData', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps text fields and repeated values while skipping files', () => {
    const entries: Array<[string, FormDataEntryValue]> = [
      ['title', 'Trip notes'],
      ['tag', 'coast'],
      ['tag', 'sunset'],
      ['attachment', new File(['image bytes'], 'sunset.png', { type: 'image/png' })],
    ];
    const formElement = {} as HTMLFormElement;

    vi.stubGlobal('document', {
      querySelector: vi.fn().mockReturnValue(formElement),
    });
    vi.stubGlobal(
      'FormData',
      class {
        [Symbol.iterator]() {
          return entries[Symbol.iterator]();
        }
      }
    );

    expect(getFormData('.example-form')).toEqual({
      title: 'Trip notes',
      tag: ['coast', 'sunset'],
    });
  });
});
