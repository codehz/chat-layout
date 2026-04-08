export function shallow<T extends object>(object: T): T {
  return Object.create(object) as T;
}
