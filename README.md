# Beeldbank-pipeline (los van de app)
Deze branch bevat geen app-code. Een job in `jobs/` wordt door GitHub Actions verwerkt:
Canva-export op volle resolutie -> 480x480 JPEG, crème 251/244/234, ~80% vulling -> `out/<batch>/` (zip, contact sheet, rapport).
Niets hier wordt automatisch naar de app of Supabase geüpload.
