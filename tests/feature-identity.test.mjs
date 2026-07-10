import assert from "node:assert/strict";
import test from "node:test";

import { identityWhereForFeature, sqlLiteral } from "../js/feature-identity.js";

test("sqlLiteral escapes string values", () => {
  assert.equal(sqlLiteral("Lac d'Oeschinen"), "'Lac d''Oeschinen'");
});

test("point identity prefers the unique source key", () => {
  const graphic = {
    attributes: {
      name: "Bern",
      point_id: 42,
      point_type_id: 2,
      postal_code: "3000",
      source_key: "2:42",
      station_abbr: "BER",
    },
  };

  assert.equal(identityWhereForFeature(graphic, "point"), "source_key = '2:42'");
});

test("point identity falls back to the stable numeric composite", () => {
  const graphic = {
    attributes: {
      name: "Bern",
      point_id: 42,
      point_type_id: 2,
      postal_code: "3000",
    },
  };

  assert.equal(identityWhereForFeature(graphic, "point"), "point_type_id = 2 AND point_id = 42");
});

test("surface identity keeps the row and column fallback", () => {
  const graphic = { attributes: { column: 18, row: 7 } };

  assert.equal(identityWhereForFeature(graphic, "polygon"), "row = 7 AND column = 18");
});
