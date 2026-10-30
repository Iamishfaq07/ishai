/** Where Orbit's offer tools live: on their own so the app shell's links don't load the offer model with them. */
export const OFFERS_HOME = "/offers";
export const offerPath = (id: string) => `${OFFERS_HOME}/${encodeURIComponent(id)}`;
