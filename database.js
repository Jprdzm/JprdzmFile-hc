const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const dbPath = path.join(__dirname, 'sistema_hc.db');
const SALT_ROUNDS = 10;

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) { console.error('Error al conectar con SQLite:', err.message); }
  else { console.log('Conexión exitosa a la base de datos SQLite.'); inicializarBaseDeDatos(); }
});

function dbAll(sql, params = []) { return new Promise((resolve, reject) => { db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))); }); }
function dbGet(sql, params = []) { return new Promise((resolve, reject) => { db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))); }); }
function dbRun(sql, params = []) { return new Promise((resolve, reject) => { db.run(sql, params, function (err) { err ? reject(err) : resolve(this); }); }); }

function generarHash(contenido) { return crypto.createHash('sha256').update(contenido, 'utf8').digest('hex'); }
function generarHashNota(nota, hashAnterior) {
  const cadena = `${hashAnterior}|${nota.folio_paciente}|${nota.id_usuario_creador}|${nota.fecha_creacion}|${nota.tipo_nota || 'evolucion'}|${nota.motivo_consulta}|${nota.exploracion_fisica}|${nota.diagnostico_principal_cie10}|${nota.plan_tratamiento || ''}`;
  return generarHash(cadena);
}

function inicializarBaseDeDatos() {
  db.serialize(async () => {
    db.run(`CREATE TABLE IF NOT EXISTS Paciente (
      folio_interno TEXT PRIMARY KEY, curp TEXT NOT NULL UNIQUE, nombre TEXT NOT NULL, primer_apellido TEXT NOT NULL, segundo_apellido TEXT,
      fecha_nacimiento TEXT NOT NULL, sexo TEXT NOT NULL CHECK(sexo IN ('M', 'H')), entidad_nacimiento TEXT NOT NULL, nacionalidad TEXT NOT NULL,
      entidad_residencia TEXT NOT NULL, municipio_residencia TEXT NOT NULL, localidad_residencia TEXT NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS Usuario_PersonalSalud (
      id_usuario INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, nombre_completo TEXT NOT NULL,
      cedula_profesional TEXT, titulo TEXT NOT NULL DEFAULT 'Dr.', sexo TEXT NOT NULL DEFAULT 'M', rol TEXT NOT NULL, activo INTEGER DEFAULT 1
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS Registro_Auditoria (
      id_auditoria INTEGER PRIMARY KEY AUTOINCREMENT, id_usuario INTEGER NOT NULL, fecha_hora TEXT NOT NULL, accion_realizada TEXT NOT NULL,
      id_registro_afectado TEXT, detalles TEXT, FOREIGN KEY (id_usuario) REFERENCES Usuario_PersonalSalud(id_usuario)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS Historia_Clinica_Nota (
      id_nota INTEGER PRIMARY KEY AUTOINCREMENT, folio_paciente TEXT NOT NULL, id_usuario_creador INTEGER NOT NULL, fecha_creacion TEXT NOT NULL,
      tipo_nota TEXT NOT NULL DEFAULT 'evolucion',
      motivo_consulta TEXT NOT NULL, exploracion_fisica TEXT, diagnostico_principal_cie10 TEXT NOT NULL, plan_tratamiento TEXT,
      campos_extra TEXT,
      hash_nota TEXT NOT NULL, hash_anterior TEXT NOT NULL, firma_profesional TEXT,
      FOREIGN KEY (folio_paciente) REFERENCES Paciente(folio_interno), FOREIGN KEY (id_usuario_creador) REFERENCES Usuario_PersonalSalud(id_usuario)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS Consentimiento_Informado (
      id_consentimiento INTEGER PRIMARY KEY AUTOINCREMENT, folio_paciente TEXT NOT NULL, id_usuario_creador INTEGER NOT NULL, fecha_creacion TEXT NOT NULL,
      tipo_procedimiento TEXT NOT NULL, descripcion_procedimiento TEXT NOT NULL, riesgos TEXT NOT NULL, beneficios TEXT, alternativas TEXT,
      firma_paciente TEXT NOT NULL, nombre_paciente_firmante TEXT NOT NULL, firma_testigo1 TEXT NOT NULL, nombre_testigo1 TEXT NOT NULL,
      firma_testigo2 TEXT NOT NULL, nombre_testigo2 TEXT NOT NULL, firma_medico TEXT NOT NULL, nombre_medico TEXT NOT NULL, hash_documento TEXT NOT NULL,
      FOREIGN KEY (folio_paciente) REFERENCES Paciente(folio_interno), FOREIGN KEY (id_usuario_creador) REFERENCES Usuario_PersonalSalud(id_usuario)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS Receta_Medica (
      id_receta INTEGER PRIMARY KEY AUTOINCREMENT, folio_paciente TEXT NOT NULL, id_usuario_creador INTEGER NOT NULL, fecha_creacion TEXT NOT NULL,
      diagnostico TEXT NOT NULL, medicamentos TEXT NOT NULL, indicaciones TEXT, tipo_receta TEXT NOT NULL DEFAULT 'general',
      firma_medico TEXT, cedula_medico TEXT, nombre_medico TEXT NOT NULL, hash_receta TEXT NOT NULL,
      FOREIGN KEY (folio_paciente) REFERENCES Paciente(folio_interno), FOREIGN KEY (id_usuario_creador) REFERENCES Usuario_PersonalSalud(id_usuario)
    )`);

    // Migrar tabla existente: agregar columnas si no existen
    try {
      await dbRun(`ALTER TABLE Historia_Clinica_Nota ADD COLUMN tipo_nota TEXT NOT NULL DEFAULT 'evolucion'`);
    } catch(e) { /* columna ya existe */ }
    try {
      await dbRun(`ALTER TABLE Historia_Clinica_Nota ADD COLUMN campos_extra TEXT`);
    } catch(e) { /* columna ya existe */ }

    console.log('Tablas inicializadas según NOM-004 y NOM-024.');

    try {
      const row = await dbGet("SELECT COUNT(*) AS count FROM Usuario_PersonalSalud");
      if (row.count === 0) {
        const hash = await bcrypt.hash('1234', SALT_ROUNDS);
        await dbRun(
          `INSERT INTO Usuario_PersonalSalud (username, password_hash, nombre_completo, cedula_profesional, titulo, sexo, rol) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ['admin', hash, 'Administrador del Sistema', '12345678', 'Dr.', 'M', 'Admin']
        );
        console.log('Usuario admin creado.');
      }
    } catch (e) { console.error('Error creando admin:', e); }
  });
}

async function registrarAuditoria(idUsuario, accion, idRegistro = null, detalles = null) {
  await dbRun(`INSERT INTO Registro_Auditoria (id_usuario, fecha_hora, accion_realizada, id_registro_afectado, detalles) VALUES (?, ?, ?, ?, ?)`,
    [idUsuario, new Date().toISOString(), accion, idRegistro, detalles]);
}

function validarCURP(curp) { return /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/.test(curp); }
function validarFechaNacimiento(fecha) {
  if (!/^\d{8}$/.test(fecha)) return false;
  const a = parseInt(fecha.substring(0,4)), m = parseInt(fecha.substring(4,6)), d = parseInt(fecha.substring(6,8));
  const dt = new Date(a, m-1, d);
  return dt.getFullYear()===a && dt.getMonth()===m-1 && dt.getDate()===d && a>=1900 && a<=new Date().getFullYear();
}
function calcularEdad(f) {
  const a=parseInt(f.substring(0,4)), m=parseInt(f.substring(4,6))-1, d=parseInt(f.substring(6,8));
  const h=new Date(); let e=h.getFullYear()-a;
  if(h.getMonth()<m||(h.getMonth()===m&&h.getDate()<d)) e--;
  return e;
}

module.exports = { db, dbAll, dbGet, dbRun, registrarAuditoria, validarCURP, validarFechaNacimiento, calcularEdad, generarHash, generarHashNota, bcrypt, SALT_ROUNDS };