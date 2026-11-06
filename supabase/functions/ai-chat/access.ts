// Wie mag de AI gebruiken? Eén plek met de regels, zodat ze automatisch getest kunnen worden (tests/check.mjs).
// - Staat de AI aan voor de doelgroep (ai_config.active_adult / active_kids), dan mag iedereen chatten.
// - Staat de AI uit, dan mag niemand chatten. Ook de beheerder niet, TENZIJ de server-instelling
//   AI_ADMIN_PREVIEW (Supabase Secret) precies op "aan" staat. Dan mag alleen de beheerder proefgesprekken voeren.
// - De dialecttest is alleen voor de beheerder, en alleen als AI_ADMIN_PREVIEW op "aan" staat.
// - De instelling komt uitsluitend van de server. Niets uit het verzoek van de app telt mee.

export const previewAllowed = (value: string | undefined | null): boolean =>
  String(value ?? "").trim().toLowerCase() === "aan";

export type Decision = { ok: true } | { ok: false; status: number; error: string };

export function canUseAi(o: { action: string; active: boolean; isAdmin: boolean; preview: boolean }): Decision {
  if (o.action === "dialect-test") {
    if (o.isAdmin !== true) return { ok: false, status: 403, error: "Alleen voor beheerders" };
    if (o.preview !== true) return { ok: false, status: 403, error: "De proefmodus staat uit." };
    return { ok: true };
  }
  if (o.action === "chat") {
    if (o.active === true) return { ok: true };
    if (o.isAdmin === true && o.preview === true) return { ok: true };
    return { ok: false, status: 403, error: "De taalpartner is nog niet geactiveerd." };
  }
  return { ok: false, status: 400, error: "Onbekende actie" };
}
