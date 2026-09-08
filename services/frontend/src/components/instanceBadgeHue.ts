export function instanceHue(instanceID: string) {
  let hash = 0
  for (const character of instanceID) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return hash % 360
}
