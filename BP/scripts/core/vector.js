// @ts-check

export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(vector, scalar) {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar
  };
}

export function length(vector) {
  return Math.sqrt(
    vector.x * vector.x + vector.y * vector.y + vector.z * vector.z
  );
}

export function normalize(vector) {
  const magnitude = length(vector);
  if (magnitude < 0.0001) {
    return { x: 0, y: 0, z: 1 };
  }

  return scale(vector, 1 / magnitude);
}

export function distance(a, b) {
  return length(subtract(a, b));
}

export function horizontalDistance(a, b) {
  const x = a.x - b.x;
  const z = a.z - b.z;
  return Math.sqrt(x * x + z * z);
}

export function rotateY(vector, degrees) {
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);

  return {
    x: vector.x * cosine - vector.z * sine,
    y: vector.y,
    z: vector.x * sine + vector.z * cosine
  };
}
