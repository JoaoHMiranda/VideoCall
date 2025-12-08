import os
import socket
from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room
from dotenv import load_dotenv

# Carrega as variáveis do arquivo .env
load_dotenv()

# Configuração
app = Flask(__name__)
app.config['SECRET_KEY'] = 'chave_secreta'
socketio = SocketIO(app, cors_allowed_origins='*')

@app.route('/')
def index():
    return render_template('index.html')

# --- Lógica WebRTC ---
@socketio.on('join')
def handle_join(room_name):
    join_room(room_name)
    emit('new-peer', {'peer_id': request.sid}, room=room_name, include_self=False)

@socketio.on('signal')
def handle_signal(data):
    emit('signal', {
        'sender_sid': request.sid,
        'type': data['type'],
        'payload': data['payload']
    }, room=data['target_sid'])

@socketio.on('disconnect')
def handle_disconnect():
    emit('peer-disconnected', {'peer_id': request.sid}, broadcast=True)

# Função para pegar o IP Limpo
def get_ip_address():
    # 1. Tenta pegar do .env (Melhor para quem usa WSL)
    env_ip = os.getenv('WINDOWS_IP')
    if env_ip:
        # CORREÇÃO: Remove aspas e espaços extras para o link funcionar
        return env_ip.replace('"', '').replace("'", "").strip()
    
    # 2. Se não tiver no .env, tenta descobrir sozinho
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        IP = s.getsockname()[0]
    except Exception:
        IP = '127.0.0.1'
    finally:
        s.close()
    return IP

if __name__ == '__main__':
    meu_ip = get_ip_address()

    print("="*60)
    print(" 1. Garanta que o celular está no mesmo Wi-Fi.")
    # Agora o link sairá limpo, ex: https://192.168.15.4:5000
    print(f" 2. Acesse: https://{meu_ip}:5000") 
    print("="*60)

    socketio.run(app, host='0.0.0.0', port=5000, 
                 ssl_context=('certs/cert.pem', 'certs/key.pem'), 
                 debug=False, use_reloader=False)