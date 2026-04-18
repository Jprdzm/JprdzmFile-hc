'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

// ──────────────────────────────────────────────────────────────────────────
// Database setup
// ──────────────────────────────────────────────────────────────────────────
let db;

function initDatabase() {
  const Database = require('better-sqlite3');
  const dbPath = path.join(app.getPath('userData'), 'historias_clinicas.db');
  db = new Database(dbPath);

  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS pacientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      apellido_paterno TEXT NOT NULL,
      apellido_materno TEXT,
      fecha_nacimiento TEXT,
      sexo TEXT,
      curp TEXT,
      nss TEXT,
      telefono TEXT,
      direccion TEXT,
      correo TEXT,
      grupo_sanguineo TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS notas_clinicas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paciente_id INTEGER NOT NULL,
      tipo_nota TEXT NOT NULL,
      fecha_nota TEXT DEFAULT (datetime('now','localtime')),
      medico_nombre TEXT,
      medico_cedula TEXT,
      medico_especialidad TEXT,
      diagnosticos_cie10 TEXT,
      plan_tratamiento TEXT,
      campos_extra TEXT,
      hash_integridad TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (paciente_id) REFERENCES pacientes(id)
    );

    CREATE INDEX IF NOT EXISTS idx_notas_paciente ON notas_clinicas(paciente_id);
    CREATE INDEX IF NOT EXISTS idx_notas_tipo ON notas_clinicas(tipo_nota);
    CREATE INDEX IF NOT EXISTS idx_pacientes_nombre ON pacientes(apellido_paterno, nombre);
  `);
}

// ──────────────────────────────────────────────────────────────────────────
// Helper: compute integrity hash
// ──────────────────────────────────────────────────────────────────────────
function computeHash(data) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex');
}

// ──────────────────────────────────────────────────────────────────────────
// Window creation
// ──────────────────────────────────────────────────────────────────────────
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    title: 'Historia Clínica Electrónica — NOM-004-SSA3-2012',
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'dashboard.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

// ──────────────────────────────────────────────────────────────────────────
// App lifecycle
// ──────────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  initDatabase();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ──────────────────────────────────────────────────────────────────────────
// IPC Handlers — Pacientes
// ──────────────────────────────────────────────────────────────────────────
ipcMain.handle('guardar-paciente', (_event, paciente) => {
  try {
    if (paciente.id) {
      const stmt = db.prepare(`
        UPDATE pacientes
        SET nombre = @nombre,
            apellido_paterno = @apellido_paterno,
            apellido_materno = @apellido_materno,
            fecha_nacimiento = @fecha_nacimiento,
            sexo = @sexo,
            curp = @curp,
            nss = @nss,
            telefono = @telefono,
            direccion = @direccion,
            correo = @correo,
            grupo_sanguineo = @grupo_sanguineo,
            updated_at = datetime('now','localtime')
        WHERE id = @id
      `);
      stmt.run(paciente);
      return { ok: true, id: paciente.id };
    } else {
      const stmt = db.prepare(`
        INSERT INTO pacientes
          (nombre, apellido_paterno, apellido_materno, fecha_nacimiento,
           sexo, curp, nss, telefono, direccion, correo, grupo_sanguineo)
        VALUES
          (@nombre, @apellido_paterno, @apellido_materno, @fecha_nacimiento,
           @sexo, @curp, @nss, @telefono, @direccion, @correo, @grupo_sanguineo)
      `);
      const info = stmt.run(paciente);
      return { ok: true, id: info.lastInsertRowid };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('buscar-pacientes', (_event, query) => {
  try {
    const term = `%${query || ''}%`;
    const rows = db
      .prepare(`
        SELECT * FROM pacientes
        WHERE nombre LIKE ?
           OR apellido_paterno LIKE ?
           OR apellido_materno LIKE ?
           OR curp LIKE ?
        ORDER BY apellido_paterno, nombre
        LIMIT 100
      `)
      .all(term, term, term, term);
    return { ok: true, data: rows };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('obtener-paciente', (_event, id) => {
  try {
    const row = db.prepare('SELECT * FROM pacientes WHERE id = ?').get(id);
    return { ok: true, data: row };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('eliminar-paciente', (_event, id) => {
  try {
    db.prepare('DELETE FROM notas_clinicas WHERE paciente_id = ?').run(id);
    db.prepare('DELETE FROM pacientes WHERE id = ?').run(id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ──────────────────────────────────────────────────────────────────────────
// IPC Handlers — Notas Clínicas
// ──────────────────────────────────────────────────────────────────────────
ipcMain.handle('guardar-nota', (_event, nota) => {
  try {
    const camposExtraStr = typeof nota.campos_extra === 'string'
      ? nota.campos_extra
      : JSON.stringify(nota.campos_extra || {});

    const hashData = {
      paciente_id: nota.paciente_id,
      tipo_nota: nota.tipo_nota,
      fecha_nota: nota.fecha_nota,
      medico_nombre: nota.medico_nombre,
      medico_cedula: nota.medico_cedula,
      diagnosticos_cie10: nota.diagnosticos_cie10,
      plan_tratamiento: nota.plan_tratamiento,
      campos_extra: camposExtraStr
    };
    const hash = computeHash(hashData);

    if (nota.id) {
      const stmt = db.prepare(`
        UPDATE notas_clinicas
        SET tipo_nota = @tipo_nota,
            fecha_nota = @fecha_nota,
            medico_nombre = @medico_nombre,
            medico_cedula = @medico_cedula,
            medico_especialidad = @medico_especialidad,
            diagnosticos_cie10 = @diagnosticos_cie10,
            plan_tratamiento = @plan_tratamiento,
            campos_extra = @campos_extra,
            hash_integridad = @hash_integridad
        WHERE id = @id
      `);
      stmt.run({
        ...nota,
        campos_extra: camposExtraStr,
        hash_integridad: hash
      });
      return { ok: true, id: nota.id };
    } else {
      const stmt = db.prepare(`
        INSERT INTO notas_clinicas
          (paciente_id, tipo_nota, fecha_nota, medico_nombre, medico_cedula,
           medico_especialidad, diagnosticos_cie10, plan_tratamiento,
           campos_extra, hash_integridad)
        VALUES
          (@paciente_id, @tipo_nota, @fecha_nota, @medico_nombre, @medico_cedula,
           @medico_especialidad, @diagnosticos_cie10, @plan_tratamiento,
           @campos_extra, @hash_integridad)
      `);
      const info = stmt.run({
        ...nota,
        campos_extra: camposExtraStr,
        hash_integridad: hash
      });
      return { ok: true, id: info.lastInsertRowid };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('obtener-notas', (_event, pacienteId) => {
  try {
    const rows = db
      .prepare('SELECT * FROM notas_clinicas WHERE paciente_id = ? ORDER BY fecha_nota DESC')
      .all(pacienteId);
    return { ok: true, data: rows };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('obtener-nota', (_event, id) => {
  try {
    const row = db.prepare('SELECT * FROM notas_clinicas WHERE id = ?').get(id);
    return { ok: true, data: row };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('eliminar-nota', (_event, id) => {
  try {
    db.prepare('DELETE FROM notas_clinicas WHERE id = ?').run(id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('verificar-integridad-notas', (_event, pacienteId) => {
  try {
    const rows = db
      .prepare('SELECT * FROM notas_clinicas WHERE paciente_id = ?')
      .all(pacienteId);

    const resultados = rows.map((nota) => {
      const hashData = {
        paciente_id: nota.paciente_id,
        tipo_nota: nota.tipo_nota,
        fecha_nota: nota.fecha_nota,
        medico_nombre: nota.medico_nombre,
        medico_cedula: nota.medico_cedula,
        diagnosticos_cie10: nota.diagnosticos_cie10,
        plan_tratamiento: nota.plan_tratamiento,
        campos_extra: nota.campos_extra
      };
      const hashEsperado = computeHash(hashData);
      return {
        id: nota.id,
        tipo_nota: nota.tipo_nota,
        fecha_nota: nota.fecha_nota,
        integro: nota.hash_integridad === hashEsperado
      };
    });

    return { ok: true, data: resultados };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
