'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // ── Pacientes ─────────────────────────────────────────────────────────────
  guardarPaciente: (paciente) => ipcRenderer.invoke('guardar-paciente', paciente),
  buscarPacientes: (query) => ipcRenderer.invoke('buscar-pacientes', query),
  obtenerPaciente: (id) => ipcRenderer.invoke('obtener-paciente', id),
  eliminarPaciente: (id) => ipcRenderer.invoke('eliminar-paciente', id),

  // ── Notas clínicas ───────────────────────────────────────────────────────
  guardarNota: (nota) => ipcRenderer.invoke('guardar-nota', nota),
  obtenerNotas: (pacienteId) => ipcRenderer.invoke('obtener-notas', pacienteId),
  obtenerNota: (id) => ipcRenderer.invoke('obtener-nota', id),
  eliminarNota: (id) => ipcRenderer.invoke('eliminar-nota', id),
  verificarIntegridadNotas: (pacienteId) =>
    ipcRenderer.invoke('verificar-integridad-notas', pacienteId)
});
