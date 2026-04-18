'use strict';

/**
 * Tests del catálogo CIE-10 (cie10_catalogo.js)
 * Ejecutar con: node --test test/cie10.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { CIE10_CATALOGO } = require(path.join(__dirname, '..', 'cie10_catalogo.js'));

// ── Estructura básica ─────────────────────────────────────────────────────

describe('Catálogo CIE-10 — estructura básica', () => {
  test('el catálogo exporta un array', () => {
    assert.ok(Array.isArray(CIE10_CATALOGO), 'CIE10_CATALOGO debe ser un array');
  });

  test('el catálogo tiene al menos 400 entradas', () => {
    assert.ok(
      CIE10_CATALOGO.length >= 400,
      `Se esperaban ≥400 entradas, hay ${CIE10_CATALOGO.length}`
    );
  });

  test('cada entrada tiene las propiedades "codigo" y "descripcion"', () => {
    for (const [i, item] of CIE10_CATALOGO.entries()) {
      assert.ok(
        typeof item.codigo === 'string' && item.codigo.length > 0,
        `Entrada [${i}] no tiene "codigo" válido`
      );
      assert.ok(
        typeof item.descripcion === 'string' && item.descripcion.length > 0,
        `Entrada [${i}] (${item.codigo}) no tiene "descripcion" válida`
      );
    }
  });

  test('los códigos no tienen espacios en blanco al inicio o al final', () => {
    for (const item of CIE10_CATALOGO) {
      assert.strictEqual(
        item.codigo,
        item.codigo.trim(),
        `Código con espacios: "${item.codigo}"`
      );
    }
  });

  test('las descripciones no están vacías ni son solo espacios', () => {
    for (const item of CIE10_CATALOGO) {
      assert.ok(
        item.descripcion.trim().length > 0,
        `Descripción vacía en código "${item.codigo}"`
      );
    }
  });
});

// ── Formato de códigos ────────────────────────────────────────────────────

describe('Catálogo CIE-10 — formato de códigos', () => {
  const CIE10_PATRON = /^[A-Z]\d{2}(\.\d{1,2})?$/;

  test('todos los códigos cumplen el patrón CIE-10 (letra + 2 dígitos + opcional .subdivisión)', () => {
    const invalidos = CIE10_CATALOGO.filter(item => !CIE10_PATRON.test(item.codigo));
    assert.strictEqual(
      invalidos.length,
      0,
      `Códigos con formato inválido: ${invalidos.map(i => i.codigo).join(', ')}`
    );
  });

  test('los códigos empiezan con letra mayúscula A-Z', () => {
    for (const item of CIE10_CATALOGO) {
      assert.match(
        item.codigo[0],
        /[A-Z]/,
        `Código "${item.codigo}" no empieza con letra mayúscula`
      );
    }
  });
});

// ── Unicidad ─────────────────────────────────────────────────────────────

describe('Catálogo CIE-10 — unicidad', () => {
  test('no hay códigos duplicados', () => {
    const vistos = new Set();
    const duplicados = [];
    for (const item of CIE10_CATALOGO) {
      if (vistos.has(item.codigo)) {
        duplicados.push(item.codigo);
      }
      vistos.add(item.codigo);
    }
    assert.deepStrictEqual(
      duplicados,
      [],
      `Códigos duplicados encontrados: ${duplicados.join(', ')}`
    );
  });
});

// ── Cobertura de capítulos (I al XXI) ────────────────────────────────────

describe('Catálogo CIE-10 — cobertura de capítulos', () => {
  // Capítulos verificados por rango de letra inicial del código
  const capitulosEsperados = [
    { cap: 'I   (A–B) Infecciosas',              prefijo: /^[AB]/ },
    { cap: 'II  (C–D) Neoplasias',               prefijo: /^[CD][0-4]/ },
    { cap: 'III (D5–D8) Sangre',                 prefijo: /^D[5-8]/ },
    { cap: 'IV  (E) Endocrinas/Metabólicas',     prefijo: /^E/ },
    { cap: 'V   (F) Mentales',                   prefijo: /^F/ },
    { cap: 'VI  (G) Nervioso',                   prefijo: /^G/ },
    { cap: 'VII (H0–H5) Ojo',                    prefijo: /^H[0-5]/ },
    { cap: 'VIII(H6–H9) Oído',                   prefijo: /^H[6-9]/ },
    { cap: 'IX  (I) Circulatorio',               prefijo: /^I/ },
    { cap: 'X   (J) Respiratorio',               prefijo: /^J/ },
    { cap: 'XI  (K) Digestivo',                  prefijo: /^K/ },
    { cap: 'XII (L) Piel',                       prefijo: /^L/ },
    { cap: 'XIII(M) Musculoesquelético',         prefijo: /^M/ },
    { cap: 'XIV (N) Genitourinario',             prefijo: /^N/ },
    { cap: 'XV  (O) Embarazo/Parto',             prefijo: /^O/ },
    { cap: 'XVI (P) Perinatal',                  prefijo: /^P/ },
    { cap: 'XVII(Q) Malformaciones',             prefijo: /^Q/ },
    { cap: 'XVIII(R) Síntomas/Signos',           prefijo: /^R/ },
    { cap: 'XIX (S–T) Traumatismos',             prefijo: /^[ST]/ },
    { cap: 'XX  (V–Y) Causas externas',          prefijo: /^[VWX-Y]/ },
    { cap: 'XXI (Z) Factores de salud',          prefijo: /^Z/ },
  ];

  for (const { cap, prefijo } of capitulosEsperados) {
    test(`el capítulo ${cap} tiene al menos 1 código`, () => {
      const encontrados = CIE10_CATALOGO.filter(item => prefijo.test(item.codigo));
      assert.ok(
        encontrados.length >= 1,
        `No se encontraron códigos para el capítulo ${cap}`
      );
    });
  }
});

// ── Búsqueda funcional ────────────────────────────────────────────────────

describe('Catálogo CIE-10 — búsqueda por código y descripción', () => {
  test('se puede encontrar "E11" (diabetes tipo 2)', () => {
    const result = CIE10_CATALOGO.find(i => i.codigo === 'E11');
    assert.ok(result, 'No se encontró E11');
    assert.match(result.descripcion.toLowerCase(), /diabetes/);
  });

  test('se puede encontrar "I10" (hipertensión esencial)', () => {
    const result = CIE10_CATALOGO.find(i => i.codigo === 'I10');
    assert.ok(result, 'No se encontró I10');
    assert.match(result.descripcion.toLowerCase(), /hipertensi/);
  });

  test('la búsqueda por descripción parcial devuelve resultados', () => {
    const termino = 'diabetes';
    const resultados = CIE10_CATALOGO.filter(i =>
      i.descripcion.toLowerCase().includes(termino)
    );
    assert.ok(resultados.length >= 5, `Se esperaban ≥5 entradas con "${termino}"`);
  });

  test('la búsqueda por código parcial devuelve resultados', () => {
    const resultados = CIE10_CATALOGO.filter(i => i.codigo.startsWith('J4'));
    assert.ok(resultados.length >= 3, 'Se esperaban ≥3 entradas con código J4x');
  });
});

// ── Concatenación con separador "|" (como lo usa el dashboard) ────────────

describe('Catálogo CIE-10 — formato de almacenamiento', () => {
  test('los códigos seleccionados se pueden unir y separar con "|"', () => {
    const seleccionados = ['E11', 'I10', 'J45.9'];
    const cadena = seleccionados.join('|');
    const recuperados = cadena.split('|').filter(Boolean);
    assert.deepStrictEqual(recuperados, seleccionados);
  });

  test('ningún código contiene el carácter "|"', () => {
    const conPipe = CIE10_CATALOGO.filter(i => i.codigo.includes('|'));
    assert.strictEqual(
      conPipe.length,
      0,
      `Códigos que contienen "|": ${conPipe.map(i => i.codigo).join(', ')}`
    );
  });
});
