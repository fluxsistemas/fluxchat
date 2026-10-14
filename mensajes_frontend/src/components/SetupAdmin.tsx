import React, { useState } from 'react';

interface SetupAdminProps {
  onSetupComplete: () => void;
}

const SetupAdmin: React.FC<SetupAdminProps> = ({ onSetupComplete }) => {
  const [usuario, setUsuario] = useState('');
  const [nombre, setNombre] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/setup-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usuario,
          nombre,
          password,
          perfil: 'admin'
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Error al crear el administrador');
      }

      onSetupComplete();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center h-screen w-full bg-[#f4f7f6]">
      <div className="bg-white p-8 rounded shadow-md w-96">
        <h2 className="text-2xl font-bold mb-6 text-center">Configuración Inicial</h2>
        <p className="text-gray-600 mb-6 text-sm text-center">
          No se encontraron usuarios en el sistema. Crea el primer usuario administrador.
        </p>
        
        {error && <div className="bg-red-100 text-red-700 p-2 rounded mb-4 text-sm">{error}</div>}

        <form onSubmit={handleSetup}>
          <div className="mb-4">
            <label className="block text-gray-700 text-sm font-bold mb-2">Usuario (Login)</label>
            <input 
              type="text" 
              className="w-full border p-2 rounded focus:outline-none focus:border-blue-500" 
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              placeholder="Ej: jperez"
              required
            />
          </div>
          <div className="mb-4">
            <label className="block text-gray-700 text-sm font-bold mb-2">Nombre Completo</label>
            <input 
              type="text" 
              className="w-full border p-2 rounded focus:outline-none focus:border-blue-500" 
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Juan Perez"
              required
            />
          </div>
          <div className="mb-6">
            <label className="block text-gray-700 text-sm font-bold mb-2">Contraseña</label>
            <input 
              type="password" 
              className="w-full border p-2 rounded focus:outline-none focus:border-blue-500" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-blue-600 text-white font-bold py-2 px-4 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Creando...' : 'Crear Administrador'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default SetupAdmin;
