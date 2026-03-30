export function shallow<T extends object>(object: T): T {
  return Object.create(object) as T;
}

export function shallowMerge<T extends object, R extends object>(object: T, other: R): T & R {
  return { __proto__: object, ...other } as unknown as T & R;
}
