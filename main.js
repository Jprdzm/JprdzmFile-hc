const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const {
  db, dbAll, dbGet, dbRun,
  registrarAuditoria,
  validarCURP, validarFechaNacimiento, calcularEdad,
  generarHash, generarHashNota,
  bcrypt, SALT_ROUNDS,
} = require('./database.js');

let mainWindow;
let sesionActiva = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200, height: 800,
    title: 'Sistema HC - Historias Clínicas',
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

// ── Navegación ───────────────────────────────────────────────────

ipcMain.handle('ir-a', async (_event, pagina) => {
  const permitidas = ['index.html', 'dashboard.html'];
  if (permitidas.includes(pagina)) { mainWindow.loadFile(pagina); return { ok: true }; }
  return { ok: false, error: 'Página no permitida' };
});

// ── Autenticación ────────────────────────────────────────────────

ipcMain.handle('login', async (_event, usuario, password) => {
  try {
    if (!usuario || !password) return { ok: false, error: 'Llena todos los campos.' };
    const row = await dbGet(
      "SELECT * FROM Usuario_PersonalSalud WHERE username = ? AND activo = 1",
      [usuario.trim().toLowerCase()]
    );
    if (!row) return { ok: false, error: 'Usuario o contraseña incorrectos.' };
    const match = await bcrypt.compare(password, row.password_hash);
    if (!match) return { ok: false, error: 'Usuario o contraseña incorrectos.' };

    sesionActiva = {
      id_usuario: row.id_usuario,
      username: row.username,
      nombre_completo: row.nombre_completo,
      cedula_profesional: row.cedula_profesional || '',
      titulo: row.titulo || 'Dr.',
      sexo: row.sexo || 'M',
      rol: row.rol,
    };
    await registrarAuditoria(row.id_usuario, 'LOGIN');
    return { ok: true, usuario: sesionActiva };
  } catch (e) {
    console.error(e);
    return { ok: false, error: 'Error interno.' };
  }
});

ipcMain.handle('registro', async (_event, datos) => {
  try {
    const { nombre, usuario, password, confirmar, cedula, titulo, sexo } = datos;
    if (!nombre || !usuario || !password || !confirmar || !titulo || !sexo)
      return { ok: false, error: 'Llena todos los campos obligatorios.' };
    if (password !== confirmar)
      return { ok: false, error: 'Las contraseñas no coinciden.' };
    if (password.length < 6)
      return { ok: false, error: 'La contraseña debe tener al menos 6 caracteres.' };

    const esMedico = titulo === 'Dr.' || titulo === 'Dra.';
    if (esMedico && !cedula)
      return { ok: false, error: 'La cédula profesional es obligatoria para médicos.' };

    const existe = await dbGet("SELECT username FROM Usuario_PersonalSalud WHERE username = ?", [usuario.trim().toLowerCase()]);
    if (existe) return { ok: false, error: 'Este usuario ya está en uso.' };

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const rol = esMedico ? 'Médico' : (titulo === 'Lic.' ? 'Enfermería' : 'Otro');

    await dbRun(
      `INSERT INTO Usuario_PersonalSalud (username, password_hash, nombre_completo, cedula_profesional, titulo, sexo, rol) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [usuario.trim().toLowerCase(), hash, nombre.trim(), esMedico ? cedula.trim() : '', titulo, sexo, rol]
    );
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: 'Error al registrar.' };
  }
});

ipcMain.handle('cerrar-sesion', async () => {
  if (sesionActiva) await registrarAuditoria(sesionActiva.id_usuario, 'LOGOUT');
  sesionActiva = null;
  mainWindow.loadFile('index.html');
  return { ok: true };
});

ipcMain.handle('obtener-sesion', async () => {
  return sesionActiva ? { ok: true, usuario: sesionActiva } : { ok: false };
});

// ── Pacientes ────────────────────────────────────────────────────

ipcMain.handle('listar-pacientes', async () => {
  try {
    if (!sesionActiva) return { ok: false, error: 'Sin sesión.' };
    const rows = await dbAll("SELECT * FROM Paciente ORDER BY folio_interno DESC LIMIT 100");
    return { ok: true, pacientes: rows };
  } catch (e) { console.error(e); return { ok: false, error: 'Error al listar.' }; }
});

ipcMain.handle('guardar-paciente', async (_event, datos) => {
  try {
    if (!sesionActiva) return { ok: false, error: 'Sin sesión.' };
    const { folio, curp, nombre, paterno, materno, fecha, sexo } = datos;
    if (!folio || !curp || !nombre || !paterno || !fecha)
      return { ok: false, error: 'Faltan datos obligatorios.' };
    const curpUpper = curp.trim().toUpperCase();
    if (!validarCURP(curpUpper)) return { ok: false, error: 'CURP con formato inválido.' };
    if (!validarFechaNacimiento(fecha.trim())) return { ok: false, error: 'Fecha de nacimiento inválida.' };

    await dbRun(
      `INSERT INTO Paciente (folio_interno, curp, nombre, primer_apellido, segundo_apellido, fecha_nacimiento, sexo, entidad_nacimiento, nacionalidad, entidad_residencia, municipio_residencia, localidad_residencia) 
       VALUES (?, ?, ?, ?, ?, ?, ?, '00', 'NND', '00', '000', '0000')`,
      [folio.trim(), curpUpper, nombre.trim(), paterno.trim(), (materno || '').trim(), fecha.trim(), sexo]
    );
    await registrarAuditoria(sesionActiva.id_usuario, 'CREAR_PACIENTE', folio.trim());
    return { ok: true };
  } catch (e) {
    console.error(e);
    if (e.message && e.message.includes('UNIQUE')) return { ok: false, error: 'El Folio o la CURP ya existen.' };
    return { ok: false, error: 'Error al guardar.' };
  }
});

ipcMain.handle('buscar-paciente', async (_event, folio) => {
  try {
    if (!sesionActiva) return { ok: false, error: 'Sin sesión.' };
    const row = await dbGet("SELECT * FROM Paciente WHERE folio_interno = ?", [folio]);
    if (!row) return { ok: false, error: 'No encontrado.' };
    row.edad = calcularEdad(row.fecha_nacimiento);
    await registrarAuditoria(sesionActiva.id_usuario, 'VER_EXPEDIENTE', folio);
    return { ok: true, paciente: row };
  } catch (e) { console.error(e); return { ok: false, error: 'Error.' }; }
});

// ── Notas Clínicas ───────────────────────────────────────────────

ipcMain.handle('guardar-nota', async (_event, datos) => {
  try {
    if (!sesionActiva) return { ok: false, error: 'Sin sesión.' };
    const { folio_paciente, tipo_nota, motivo_consulta, exploracion_fisica, diagnostico_principal_cie10, plan_tratamiento, firma_profesional, campos_extra } = datos;
    if (!folio_paciente || !motivo_consulta || !diagnostico_principal_cie10)
      return { ok: false, error: 'Faltan campos obligatorios (motivo, diagnóstico).' };

    const tiposValidos = ['primera_vez', 'evolucion', 'postanestesica', 'urgencias', 'enfermeria'];
    const tipoFinal = tiposValidos.includes(tipo_nota) ? tipo_nota : 'evolucion';

    const ultimaNota = await dbGet("SELECT hash_nota FROM Historia_Clinica_Nota WHERE folio_paciente = ? ORDER BY id_nota DESC LIMIT 1", [folio_paciente]);
    const hashAnterior = ultimaNota ? ultimaNota.hash_nota : 'GENESIS';
    const fechaCreacion = new Date().toISOString();
    const notaParaHash = {
      folio_paciente,
      id_usuario_creador: sesionActiva.id_usuario,
      fecha_creacion: fechaCreacion,
      tipo_nota: tipoFinal,
      motivo_consulta,
      exploracion_fisica: exploracion_fisica || '',
      diagnostico_principal_cie10,
      plan_tratamiento: plan_tratamiento || ''
    };
    const hashNota = generarHashNota(notaParaHash, hashAnterior);

    const camposExtraJSON = campos_extra ? JSON.stringify(campos_extra) : null;

    await dbRun(
      `INSERT INTO Historia_Clinica_Nota (folio_paciente, id_usuario_creador, fecha_creacion, tipo_nota, motivo_consulta, exploracion_fisica, diagnostico_principal_cie10, plan_tratamiento, campos_extra, hash_nota, hash_anterior, firma_profesional) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [folio_paciente, sesionActiva.id_usuario, fechaCreacion, tipoFinal, motivo_consulta, exploracion_fisica || '', diagnostico_principal_cie10, plan_tratamiento || '', camposExtraJSON, hashNota, hashAnterior, firma_profesional || '']
    );
    await registrarAuditoria(sesionActiva.id_usuario, 'CREAR_NOTA', folio_paciente, `Tipo: ${tipoFinal}, Hash: ${hashNota}`);
    return { ok: true, hash: hashNota };
  } catch (e) { console.error(e); return { ok: false, error: 'Error al guardar nota.' }; }
});

ipcMain.handle('obtener-notas', async (_event, folio) => {
  try {
    if (!sesionActiva) return { ok: false, error: 'Sin sesión.' };
    const notas = await dbAll(
      `SELECT n.*, u.nombre_completo AS nombre_creador, u.cedula_profesional FROM Historia_Clinica_Nota n JOIN Usuario_PersonalSalud u ON n.id_usuario_creador = u.id_usuario WHERE n.folio_paciente = ? ORDER BY n.fecha_creacion ASC`, [folio]
    );
    return { ok: true, notas };
  } catch (e) { console.error(e); return { ok: false, error: 'Error.' }; }
});

ipcMain.handle('verificar-integridad-notas', async (_event, folio) => {
  try {
    if (!sesionActiva) return { ok: false, error: 'Sin sesión.' };
    const notas = await dbAll("SELECT * FROM Historia_Clinica_Nota WHERE folio_paciente = ? ORDER BY id_nota ASC", [folio]);
    let hashEsperado = 'GENESIS';
    for (const nota of notas) {
      const notaParaHash = {
        folio_paciente: nota.folio_paciente,
        id_usuario_creador: nota.id_usuario_creador,
        fecha_creacion: nota.fecha_creacion,
        tipo_nota: nota.tipo_nota || 'evolucion',
        motivo_consulta: nota.motivo_consulta,
        exploracion_fisica: nota.exploracion_fisica || '',
        diagnostico_principal_cie10: nota.diagnostico_principal_cie10,
        plan_tratamiento: nota.plan_tratamiento || ''
      };
      const hashCalculado = generarHashNota(notaParaHash, hashEsperado);
      if (hashCalculado !== nota.hash_nota) return { ok: true, integro: false, nota_corrupta: nota.id_nota, mensaje: `La nota #${nota.id_nota} fue alterada.` };
      hashEsperado = nota.hash_nota;
    }
    await registrarAuditoria(sesionActiva.id_usuario, 'VERIFICAR_INTEGRIDAD', folio);
    return { ok: true, integro: true, total_notas: notas.length, mensaje: 'Todas las notas están íntegras.' };
  } catch (e) { console.error(e); return { ok: false, error: 'Error.' }; }
});

// ── Consentimiento Informado ─────────────────────────────────────

ipcMain.handle('guardar-consentimiento', async (_event, datos) => {
  try {
    if (!sesionActiva) return { ok: false, error: 'Sin sesión.' };
    const { folio_paciente, tipo_procedimiento, descripcion_procedimiento, riesgos, beneficios, alternativas, firma_paciente, nombre_paciente_firmante, firma_testigo1, nombre_testigo1, firma_testigo2, nombre_testigo2, firma_medico } = datos;
    if (!folio_paciente || !tipo_procedimiento || !descripcion_procedimiento || !riesgos) return { ok: false, error: 'Faltan campos obligatorios.' };
    if (!firma_paciente || !nombre_paciente_firmante) return { ok: false, error: 'Se requiere la firma del paciente.' };
    if (!firma_testigo1 || !nombre_testigo1 || !firma_testigo2 || !nombre_testigo2) return { ok: false, error: 'Se requieren las firmas de DOS testigos.' };
    if (!firma_medico) return { ok: false, error: 'Se requiere la firma del médico tratante.' };

    const fechaCreacion = new Date().toISOString();
    const hashDoc = generarHash(`${folio_paciente}|${fechaCreacion}|${tipo_procedimiento}|${descripcion_procedimiento}|${nombre_paciente_firmante}|${nombre_testigo1}|${nombre_testigo2}|${sesionActiva.nombre_completo}`);

    await dbRun(
      `INSERT INTO Consentimiento_Informado (folio_paciente, id_usuario_creador, fecha_creacion, tipo_procedimiento, descripcion_procedimiento, riesgos, beneficios, alternativas, firma_paciente, nombre_paciente_firmante, firma_testigo1, nombre_testigo1, firma_testigo2, nombre_testigo2, firma_medico, nombre_medico, hash_documento) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [folio_paciente, sesionActiva.id_usuario, fechaCreacion, tipo_procedimiento, descripcion_procedimiento, riesgos, beneficios || '', alternativas || '', firma_paciente, nombre_paciente_firmante, firma_testigo1, nombre_testigo1, firma_testigo2, nombre_testigo2, firma_medico, sesionActiva.nombre_completo, hashDoc]
    );
    await registrarAuditoria(sesionActiva.id_usuario, 'CREAR_CONSENTIMIENTO', folio_paciente, `Hash: ${hashDoc}`);
    return { ok: true, hash: hashDoc };
  } catch (e) { console.error(e); return { ok: false, error: 'Error al guardar consentimiento.' }; }
});

ipcMain.handle('obtener-consentimientos', async (_event, folio) => {
  try {
    if (!sesionActiva) return { ok: false, error: 'Sin sesión.' };
    const rows = await dbAll("SELECT * FROM Consentimiento_Informado WHERE folio_paciente = ? ORDER BY fecha_creacion DESC", [folio]);
    return { ok: true, consentimientos: rows };
  } catch (e) { console.error(e); return { ok: false, error: 'Error.' }; }
});

// ── Recetas ──────────────────────────────────────────────────────

ipcMain.handle('guardar-receta', async (_event, datos) => {
  try {
    if (!sesionActiva) return { ok: false, error: 'Sin sesión.' };
    const { folio_paciente, diagnostico, medicamentos, indicaciones, tipo_receta, firma_medico } = datos;
    if (!folio_paciente || !diagnostico || !medicamentos) return { ok: false, error: 'Faltan campos obligatorios.' };
    if (!sesionActiva.cedula_profesional) return { ok: false, error: 'Se requiere cédula profesional para emitir recetas.' };

    const fechaCreacion = new Date().toISOString();
    const hashReceta = generarHash(`${folio_paciente}|${fechaCreacion}|${diagnostico}|${medicamentos}|${sesionActiva.nombre_completo}|${sesionActiva.cedula_profesional}`);

    await dbRun(
      `INSERT INTO Receta_Medica (folio_paciente, id_usuario_creador, fecha_creacion, diagnostico, medicamentos, indicaciones, tipo_receta, firma_medico, cedula_medico, nombre_medico, hash_receta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [folio_paciente, sesionActiva.id_usuario, fechaCreacion, diagnostico, medicamentos, indicaciones || '', tipo_receta || 'general', firma_medico || '', sesionActiva.cedula_profesional, sesionActiva.nombre_completo, hashReceta]
    );
    await registrarAuditoria(sesionActiva.id_usuario, 'CREAR_RECETA', folio_paciente, `Tipo: ${tipo_receta || 'general'}, Hash: ${hashReceta}`);
    return { ok: true, hash: hashReceta };
  } catch (e) { console.error(e); return { ok: false, error: 'Error al guardar receta.' }; }
});

ipcMain.handle('obtener-recetas', async (_event, folio) => {
  try {
    if (!sesionActiva) return { ok: false, error: 'Sin sesión.' };
    const rows = await dbAll("SELECT * FROM Receta_Medica WHERE folio_paciente = ? ORDER BY fecha_creacion DESC", [folio]);
    return { ok: true, recetas: rows };
  } catch (e) { console.error(e); return { ok: false, error: 'Error.' }; }
});

// ── Exportar ─────────────────────────────────────────────────────

ipcMain.handle('exportar-expediente', async (_event, folio) => {
  try {
    if (!sesionActiva) return { ok: false, error: 'Sin sesión.' };
    const paciente = await dbGet("SELECT * FROM Paciente WHERE folio_interno = ?", [folio]);
    if (!paciente) return { ok: false, error: 'No encontrado.' };

    const expediente = {
      exportado_en: new Date().toISOString(), exportado_por: sesionActiva.nombre_completo,
      formato: 'Expediente Clínico Electrónico - NOM-004 / NOM-024',
      paciente,
      historia_clinica: await dbAll("SELECT * FROM Historia_Clinica_Nota WHERE folio_paciente = ? ORDER BY fecha_creacion ASC", [folio]),
      consentimientos_informados: await dbAll("SELECT * FROM Consentimiento_Informado WHERE folio_paciente = ? ORDER BY fecha_creacion ASC", [folio]),
      recetas_medicas: await dbAll("SELECT * FROM Receta_Medica WHERE folio_paciente = ? ORDER BY fecha_creacion ASC", [folio]),
      registro_auditoria: await dbAll("SELECT * FROM Registro_Auditoria WHERE id_registro_afectado = ? ORDER BY fecha_hora ASC", [folio]),
    };

    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Exportar Expediente', defaultPath: `expediente_${folio}_${new Date().toISOString().split('T')[0]}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!filePath) return { ok: false, error: 'Cancelado.' };
    fs.writeFileSync(filePath, JSON.stringify(expediente, null, 2), 'utf8');
    await registrarAuditoria(sesionActiva.id_usuario, 'EXPORTAR_EXPEDIENTE', folio);
    return { ok: true, ruta: filePath };
  } catch (e) { console.error(e); return { ok: false, error: 'Error al exportar.' }; }
});

// ── Auditoría ────────────────────────────────────────────────────

ipcMain.handle('obtener-auditoria', async (_event, folio) => {
  try {
    if (!sesionActiva) return { ok: false, error: 'Sin sesión.' };
    const rows = await dbAll(
      `SELECT a.*, u.nombre_completo FROM Registro_Auditoria a JOIN Usuario_PersonalSalud u ON a.id_usuario = u.id_usuario WHERE a.id_registro_afectado = ? ORDER BY a.fecha_hora DESC`, [folio]
    );
    return { ok: true, registros: rows };
  } catch (e) { console.error(e); return { ok: false, error: 'Error.' }; }
});