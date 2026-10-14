// Broadcast look for the TV board (README "Draft Room TV board").
export const D = {
  nav: '#0d0f13', bg: '#0b0d11', row: '#161a22', sold: '#101319', panel: '#12151b',
  line: 'rgba(255,255,255,0.08)', text: '#ffffff', dim: '#a3aab5', dim2: '#6f7782',
  red: '#e22634', green: '#2fbf63', gold: '#f2b632',
} as const;

/** Short manager tag shown next to a sold price (the team id, e.g. AM). */
export const abbr = (id: string) => id;
