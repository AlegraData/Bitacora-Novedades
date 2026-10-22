// Sin imports de servidor: lo usan el MCP, la API, el servicio de correos y los componentes cliente.

/**
 * La Bitácora guarda los campos como filas dinámicas de `Field` (no columnas
 * fijas). Este mapa traduce los nombres lógicos que usa el spec del MCP a los
 * nombres reales de `Field.name` en producción.
 */
export const LOGICAL_FIELD_NAMES: Record<string, string> = {
  tipo: 'Tipo',
  titulo: 'Título',
  fechaLanzamiento: 'Fecha de lanzamiento',
  fechaFinEarlyAdopters: 'Fecha Fin Early Adopters',
  fechaProduccion: 'Fecha real de producción',
  elaborado: 'Elaborado',
  responsables: 'Responsables',
  version: 'Versión',
  breveDescripcion: 'Breve descripción',
  producto: 'Producto',
  sh: 'SH',
  documentacionOnePager: 'Documentación One Pager',
  proyectoLinear: 'Proyecto en Linear',
  video: 'Video',
  traeVideo: '¿Trae video?',
  prototipo: 'Prototipo',
  ia: 'IA',
  informacionBoard: 'Información Board',
  correosAComunicar: 'Correos a comunicar',
  necesitaComunicacionPMKT: 'Necesita comunicación de Product Marketing',
  usuarioImpactado: 'Usuario impactado',
  taxonomiaFeature: 'Taxonomia Feature',
  eventoFeatureAmplitude: 'Evento Feature Amplitude',
  linkTableroAmplitude: 'Link Tablero Amplitude',
  comentarioEvento: 'Comentario evento',
  manualDeUsuario: 'Manual de Usuario',
  articuloHelpCenter: 'Artículo Help Center',
  urlBitacora: 'URL Bitácora',
  status: 'Status',
}
