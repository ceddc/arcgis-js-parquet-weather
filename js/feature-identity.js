export function sqlLiteral(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return `'${String(value).replaceAll("'", "''")}'`;
}

export function identityWhereForFeature(graphic, geometryType) {
  const attributes = graphic?.attributes ?? {};
  const candidates = geometryType === "point"
    ? [["source_key"], ["point_type_id", "point_id"], ["station_abbr"], ["postal_code"], ["name"]]
    : [["hex_cell_id"], ["row", "column"], ["nearby_source_key"]];

  for (const fieldNames of candidates) {
    const parts = fieldNames.map((fieldName) => {
      const value = attributes[fieldName];

      if (value === null || value === undefined || value === "") {
        return null;
      }

      return `${fieldName} = ${sqlLiteral(value)}`;
    });

    if (parts.every(Boolean)) {
      return parts.join(" AND ");
    }
  }

  return null;
}
