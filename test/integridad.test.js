'use strict';

/**
 * Tests de la lógica de integridad SHA-256 de notas clínicas
 * (equivalente a la función computeHash usada en main.js)
 * Ejecutar con: node --test test/integridad.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// ── Función extraída de main.js ───────────────────────────────────────────
function computeHash(data) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex');
}

// ── Helpers ───────────────────────────────────────────────────────────────
function notaEjemplo(overrides = {}) {
  return {
    paciente_id: 1,
    tipo_nota: 'primera_vez',
    fecha_nota: '2026-04-18 10:00:00',
    medico_nombre: 'Dr. Juan Pérez',
    medico_cedula: '123456',
    diagnosticos_cie10: 'E11|I10',
    plan_tratamiento: 'Metformina 500mg c/12h',
    campos_extra: JSON.stringify({ motivo_consulta: 'Revisión de control' }),
    ...overrides
  };
}

// ── Propiedades básicas del hash ──────────────────────────────────────────

describe('computeHash — propiedades básicas', () => {
  test('devuelve una cadena hexadecimal de 64 caracteres (SHA-256)', () => {
    const hash = computeHash(notaEjemplo());
    assert.strictEqual(typeof hash, 'string');
    assert.strictEqual(hash.length, 64);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  test('es determinista: mismos datos → mismo hash', () => {
    const nota = notaEjemplo();
    const hash1 = computeHash(nota);
    const hash2 = computeHash(nota);
    assert.strictEqual(hash1, hash2);
  });

  test('es sensible a cualquier cambio en los datos (efecto avalancha)', () => {
    const original = computeHash(notaEjemplo());
    const modificado = computeHash(notaEjemplo({ medico_nombre: 'Dr. Juan Perez' })); // sin tilde
    assert.notStrictEqual(original, modificado);
  });
});

// ── Detección de alteraciones ─────────────────────────────────────────────

describe('computeHash — detección de alteraciones (integridad)', () => {
  test('detecta cambio en tipo_nota', () => {
    const h1 = computeHash(notaEjemplo({ tipo_nota: 'primera_vez' }));
    const h2 = computeHash(notaEjemplo({ tipo_nota: 'evolucion' }));
    assert.notStrictEqual(h1, h2, 'El hash no cambió al modificar tipo_nota');
  });

  test('detecta cambio en diagnósticos CIE-10', () => {
    const h1 = computeHash(notaEjemplo({ diagnosticos_cie10: 'E11|I10' }));
    const h2 = computeHash(notaEjemplo({ diagnosticos_cie10: 'E11|I10|J45.9' }));
    assert.notStrictEqual(h1, h2, 'El hash no cambió al añadir un diagnóstico');
  });

  test('detecta cambio en plan de tratamiento', () => {
    const h1 = computeHash(notaEjemplo({ plan_tratamiento: 'Metformina 500mg c/12h' }));
    const h2 = computeHash(notaEjemplo({ plan_tratamiento: 'Metformina 850mg c/8h' }));
    assert.notStrictEqual(h1, h2, 'El hash no cambió al modificar plan_tratamiento');
  });

  test('detecta cambio en campos_extra', () => {
    const h1 = computeHash(notaEjemplo({ campos_extra: JSON.stringify({ motivo_consulta: 'A' }) }));
    const h2 = computeHash(notaEjemplo({ campos_extra: JSON.stringify({ motivo_consulta: 'B' }) }));
    assert.notStrictEqual(h1, h2, 'El hash no cambió al modificar campos_extra');
  });

  test('detecta cambio en paciente_id', () => {
    const h1 = computeHash(notaEjemplo({ paciente_id: 1 }));
    const h2 = computeHash(notaEjemplo({ paciente_id: 2 }));
    assert.notStrictEqual(h1, h2, 'El hash no cambió al modificar paciente_id');
  });
});

// ── Simulación del flujo guardar → verificar ──────────────────────────────

describe('computeHash — flujo completo guardar/verificar', () => {
  test('una nota sin modificar supera la verificación de integridad', () => {
    const nota = notaEjemplo();
    const hashGuardado = computeHash(nota);

    // Simulamos leer la nota de la BD y re-calcular
    const hashVerificado = computeHash(nota);
    assert.strictEqual(
      hashGuardado,
      hashVerificado,
      'La nota íntegra no pasó la verificación'
    );
  });

  test('una nota alterada NO supera la verificación de integridad', () => {
    const nota = notaEjemplo();
    const hashGuardado = computeHash(nota);

    // Simulamos que alguien modificó el plan de tratamiento directamente en la BD
    const notaAlterada = { ...nota, plan_tratamiento: 'Tratamiento adulterado' };
    const hashVerificado = computeHash(notaAlterada);

    assert.notStrictEqual(
      hashGuardado,
      hashVerificado,
      'Una nota alterada debería tener un hash diferente'
    );
  });

  test('los 5 tipos de notas producen hashes distintos entre sí para el mismo paciente', () => {
    const tipos = ['primera_vez', 'evolucion', 'postanestesica', 'urgencias', 'enfermeria'];
    const hashes = tipos.map(tipo => computeHash(notaEjemplo({ tipo_nota: tipo })));
    const unicos = new Set(hashes);
    assert.strictEqual(
      unicos.size,
      tipos.length,
      'Dos tipos de nota diferentes produjeron el mismo hash'
    );
  });
});

// ── Casos borde ───────────────────────────────────────────────────────────

describe('computeHash — casos borde', () => {
  test('funciona con campos_extra vacío (cadena vacía)', () => {
    const hash = computeHash(notaEjemplo({ campos_extra: '' }));
    assert.ok(hash.length === 64);
  });

  test('funciona con diagnosticos_cie10 nulo/vacío', () => {
    const h1 = computeHash(notaEjemplo({ diagnosticos_cie10: null }));
    const h2 = computeHash(notaEjemplo({ diagnosticos_cie10: '' }));
    assert.ok(h1.length === 64);
    assert.ok(h2.length === 64);
    // null y '' producen hashes diferentes (JSON.stringify los trata diferente)
    assert.notStrictEqual(h1, h2);
  });

  test('no hay colisiones entre 1000 notas distintas', () => {
    const hashes = new Set();
    for (let i = 0; i < 1000; i++) {
      hashes.add(computeHash(notaEjemplo({ paciente_id: i, fecha_nota: `2026-01-${String(i % 28 + 1).padStart(2, '0')}` })));
    }
    assert.strictEqual(hashes.size, 1000, 'Se detectaron colisiones de hash');
  });
});
