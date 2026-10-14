import React, { useState } from 'react';
import { MessageSquare } from 'lucide-react';

interface LoginProps {
  onLoginSuccess: (token: string, usuario: any) => void;
}

const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const formData = new URLSearchParams();
      formData.append('username', username);
      formData.append('password', password);

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
      });

      if (!res.ok) {
        throw new Error('Usuario o contraseña incorrectos');
      }

      const data = await res.json();
      localStorage.setItem('token', data.access_token);
      localStorage.setItem('usuario', JSON.stringify(data.usuario));
      onLoginSuccess(data.access_token, data.usuario);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen w-full bg-gray-50 p-4 font-sans text-gray-800">
      <div className="bg-white p-8 sm:p-10 rounded-[24px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] w-full max-w-[400px]">
        
        <div className="flex flex-col items-center mb-8">
          <div className="bg-gray-50 p-3.5 rounded-2xl text-gray-900 mb-4">
            <MessageSquare size={32} strokeWidth={1.5} />
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight mb-2">FluxChat</h2>
          <p className="text-gray-500 font-medium text-center text-[15px]">
            Ingresa tus credenciales para continuar
          </p>
        </div>
        
        {error && (
          <div className="bg-red-50 text-red-600 p-3.5 rounded-2xl mb-6 text-[14px] font-medium border border-red-100 text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="flex flex-col gap-5">
          <div>
            <label className="block text-gray-700 text-[14px] font-semibold mb-2 ml-1">Usuario</label>
            <input 
              type="text" 
              className="w-full bg-gray-50 border border-transparent px-4 py-3.5 rounded-2xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-200 focus:border-gray-300 transition-all text-[15px]" 
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Ej: admin"
              required
            />
          </div>
          <div>
            <label className="block text-gray-700 text-[14px] font-semibold mb-2 ml-1">Contraseña</label>
            <input 
              type="password" 
              className="w-full bg-gray-50 border border-transparent px-4 py-3.5 rounded-2xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-200 focus:border-gray-300 transition-all text-[15px]" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-gray-900 text-white font-semibold py-3.5 px-4 rounded-2xl hover:bg-gray-800 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none mt-2"
          >
            {loading ? 'Ingresando...' : 'Iniciar Sesión'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;
