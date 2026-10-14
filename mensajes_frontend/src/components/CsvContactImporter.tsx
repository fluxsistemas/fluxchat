import { useState, useRef, ChangeEvent } from 'react';
import axios from 'axios';
import { 
  Menu, 
  FileSpreadsheet, 
  UploadCloud, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  AlertCircle, 
  ArrowRight,
  Database,
  UsersRound,
  Trash2
} from 'lucide-react';

interface CsvContactImporterProps {
  onOpenSidebar: () => void;
}

export default function CsvContactImporter({ onOpenSidebar }: CsvContactImporterProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [csvPreviewRows, setCsvPreviewRows] = useState<string[][]>([]);
  const [columnMappings, setColumnMappings] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Parse CSV (supports commas and semicolons, basic quoted values)
  const parseCSVText = (text: string): string[][] => {
    const lines = text.split(/\r?\n/);
    const parsed: string[][] = [];
    
    // Detect delimiter
    let delimiter = ',';
    const firstLine = lines[0] || '';
    if (firstLine.includes(';') && !firstLine.includes(',')) {
      delimiter = ';';
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Handle simple CSV splitting with possible quotes
      const row: string[] = [];
      let inQuotes = false;
      let currentValue = '';

      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === delimiter && !inQuotes) {
          row.push(currentValue.trim());
          currentValue = '';
        } else {
          currentValue += char;
        }
      }
      row.push(currentValue.trim());
      parsed.push(row);
    }
    return parsed;
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (!file.name.endsWith('.csv')) {
        setErrorMsg("El archivo debe tener formato CSV.");
        setSelectedFile(null);
        setCsvPreviewRows([]);
        return;
      }
      setSelectedFile(file);
      setErrorMsg('');
      setSuccessMsg('');

      // Read file for preview
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        const rows = parseCSVText(text);
        if (rows.length === 0) {
          setErrorMsg("El archivo CSV está vacío.");
          setSelectedFile(null);
          return;
        }
        
        // Show first 5 rows for preview
        setCsvPreviewRows(rows.slice(0, 6));

        // Initialize column mappings
        // First column (index 0) is locked to 'numero_contacto'
        const initialMappings: Record<number, string> = { 0: 'numero_contacto' };
        
        // Basic heuristics for remaining columns
        const header = rows[0];
        if (header) {
          header.forEach((colName, index) => {
            if (index === 0) return;
            const nameLower = colName.toLowerCase();
            if (nameLower.includes('nombre') || nameLower.includes('name') || nameLower.includes('first')) {
              initialMappings[index] = 'nombres';
            } else if (nameLower.includes('apellido') || nameLower.includes('last')) {
              initialMappings[index] = 'apellidos';
            } else if (nameLower.includes('doc') || nameLower.includes('cedula') || nameLower.includes('ruc') || nameLower.includes('ci')) {
              initialMappings[index] = 'documento';
            } else if (nameLower.includes('mail') || nameLower.includes('correo') || nameLower.includes('email')) {
              initialMappings[index] = 'correo';
            } else {
              initialMappings[index] = ''; // Ignore
            }
          });
        }
        setColumnMappings(initialMappings);
      };
      reader.readAsText(file, 'utf-8');
    }
  };

  const handleMappingChange = (columnIndex: number, field: string) => {
    // Prevent changing mapping of column 0
    if (columnIndex === 0) return;

    // Check if the field is already mapped to another column to prevent duplicates
    const isAlreadyMapped = Object.entries(columnMappings).some(
      ([idx, val]) => val === field && parseInt(idx) !== columnIndex && field !== ''
    );

    if (isAlreadyMapped) {
      alert(`El campo "${field.toUpperCase()}" ya está seleccionado en otra columna.`);
      return;
    }

    setColumnMappings(prev => ({
      ...prev,
      [columnIndex]: field
    }));
  };

  const clearFile = () => {
    setSelectedFile(null);
    setCsvPreviewRows([]);
    setColumnMappings({});
    setErrorMsg('');
    setSuccessMsg('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleImportSubmit = async () => {
    if (!selectedFile) {
      setErrorMsg("Por favor, selecciona un archivo CSV.");
      return;
    }

    setLoading(true);
    setSuccessMsg('');
    setErrorMsg('');

    try {
      // Read entire file content
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = (e) => reject(e);
        reader.readAsText(selectedFile, 'utf-8');
      });

      const allRows = parseCSVText(text);
      if (allRows.length === 0) {
        throw new Error("El archivo CSV no contiene registros.");
      }

      // Determine if first row is a header
      let startIdx = 0;
      const firstRow = allRows[0];
      const hasHeader = firstRow && isNaN(Number(firstRow[0].replace(/\D/g, '')));
      if (hasHeader) {
        startIdx = 1;
      }

      const importedList: any[] = [];

      for (let i = startIdx; i < allRows.length; i++) {
        const row = allRows[i];
        if (!row || !row[0]?.trim()) continue;

        // Create contact object based on mappings
        const contactObj: Record<string, any> = {
          numero_contacto: row[0].replace(/\D/g, '') // Clear non-digits
        };

        if (!contactObj.numero_contacto) continue;

        Object.entries(columnMappings).forEach(([colIdxStr, field]) => {
          const colIdx = parseInt(colIdxStr);
          if (colIdx === 0 || !field) return;
          contactObj[field] = row[colIdx]?.trim() || null;
        });

        importedList.push(contactObj);
      }

      if (importedList.length === 0) {
        throw new Error("No se encontraron números de teléfono válidos en el archivo.");
      }

      // Send to backend endpoint
      const response = await axios.post('/api/conversaciones/contactos/importar', importedList);
      
      setSuccessMsg(response.data.message || 'Contactos procesados e importados con éxito.');
      setSelectedFile(null);
      setCsvPreviewRows([]);
      setColumnMappings({});
    } catch (err: any) {
      console.error("Error al importar contactos:", err);
      setErrorMsg(err.response?.data?.detail || err.message || "Ocurrió un error al procesar el archivo CSV.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-white relative overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <button 
            className="p-2 text-gray-500 hover:bg-gray-100 rounded-md lg:hidden"
            onClick={onOpenSidebar}
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <UsersRound size={24} className="text-blue-600" />
            <h2 className="text-xl font-semibold text-gray-800">Importar Contactos por CSV</h2>
          </div>
        </div>
      </div>

      {/* Main Area */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-[#f4f7f6]">
        <div className="max-w-5xl mx-auto space-y-6 text-left">
          
          {/* Card: File upload */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
            <div className="border-b border-gray-100 pb-3">
              <h3 className="text-base font-semibold text-gray-800">Cargar Archivo</h3>
              <p className="text-xs text-gray-500 mt-1">Sube un archivo de contactos en formato CSV para asociar nombres, apellidos, documentos o correos.</p>
            </div>

            {successMsg && (
              <div className="bg-green-50 text-green-700 p-3.5 rounded-xl text-sm border border-green-100 font-medium flex items-center gap-2">
                <CheckCircle2 size={18} /> {successMsg}
              </div>
            )}
            {errorMsg && (
              <div className="bg-red-50 text-red-700 p-3.5 rounded-xl text-sm border border-red-100 font-medium flex items-center gap-2">
                <AlertCircle size={18} /> {errorMsg}
              </div>
            )}

            {!selectedFile ? (
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-blue-500 hover:bg-blue-50/20 cursor-pointer transition-all flex flex-col items-center"
              >
                <UploadCloud size={40} className="text-gray-400 mb-2" />
                <span className="text-sm font-semibold text-gray-700">Subir archivo .csv</span>
                <span className="text-xs text-gray-400 mt-1">Haz clic para buscar en tu dispositivo</span>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileChange} 
                  accept=".csv" 
                  className="hidden" 
                />
              </div>
            ) : (
              <div className="flex items-center justify-between border border-gray-200 rounded-xl p-4 bg-gray-50">
                <div className="flex items-center gap-3">
                  <FileSpreadsheet size={24} className="text-blue-600" />
                  <div className="text-left">
                    <p className="text-sm font-bold text-gray-800">{selectedFile.name}</p>
                    <p className="text-xs text-gray-400">{(selectedFile.size / 1024).toFixed(1)} KB</p>
                  </div>
                </div>
                <button 
                  type="button" 
                  onClick={clearFile}
                  className="text-gray-400 hover:text-red-500 p-2 rounded-xl hover:bg-gray-100 transition-colors cursor-pointer"
                  title="Eliminar archivo"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            )}
          </div>

          {/* Card: Mapping and Preview */}
          {selectedFile && csvPreviewRows.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
              <div className="border-b border-gray-100 pb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-gray-800">Mapear Columnas y Vista Previa</h3>
                  <p className="text-xs text-gray-500 mt-1">Asigna a qué campo de la Base de Datos corresponde cada columna detectada en el CSV.</p>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-semibold border border-blue-100">
                  <Database size={13} />
                  <span>Estándar: 1ra Columna = Teléfono</span>
                </div>
              </div>

              {/* Grid of Mapping Selects */}
              <div className="overflow-x-auto border border-gray-200 rounded-xl">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      {csvPreviewRows[0]?.map((_, colIdx) => (
                        <th key={colIdx} className="p-4 font-semibold text-gray-700 w-fit min-w-[150px]">
                          <div className="flex flex-col gap-2">
                            <span className="text-[10px] font-bold uppercase text-gray-400 tracking-wider">
                              Columna #{colIdx + 1}
                            </span>
                            {colIdx === 0 ? (
                              <div className="w-full bg-blue-50 border border-blue-200 text-blue-700 rounded-xl px-3 py-2 text-xs font-bold text-center">
                                Teléfono (Clave)
                              </div>
                            ) : (
                              <select
                                value={columnMappings[colIdx] || ''}
                                onChange={(e) => handleMappingChange(colIdx, e.target.value)}
                                className="w-full bg-white border border-gray-200 hover:border-gray-300 text-gray-700 rounded-xl px-2 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all cursor-pointer"
                              >
                                <option value="">(Ignorar Columna)</option>
                                <option value="nombres">Nombres</option>
                                <option value="apellidos">Apellidos</option>
                                <option value="documento">Documento (CI / RUC)</option>
                                <option value="correo">Correo Electrónico</option>
                              </select>
                            )}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {csvPreviewRows.map((row, rowIdx) => (
                      <tr key={rowIdx} className={`hover:bg-gray-50/50 ${rowIdx === 0 ? 'bg-gray-50/30 italic font-medium border-b border-gray-100' : ''}`}>
                        {row.map((val, colIdx) => (
                          <td key={colIdx} className="p-4 text-gray-600 truncate max-w-[200px]">
                            {rowIdx === 0 && isNaN(Number(row[0].replace(/\D/g, ''))) ? (
                              <span className="text-gray-400">[Cabecera] {val}</span>
                            ) : (
                              val || <span className="text-gray-300 italic">-</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Import Button */}
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={handleImportSubmit}
                  disabled={loading}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-2xl text-sm shadow-md hover:shadow-lg transition-all active:scale-95 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed cursor-pointer"
                >
                  {loading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Procesando e Importando...
                    </>
                  ) : (
                    <>
                      <ArrowRight size={16} />
                      Iniciar Importación de Contactos
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
