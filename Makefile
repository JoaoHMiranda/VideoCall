# --- CARREGA O .ENV (Se existir) ---
# Necessário que o .env contenha as variáveis CERT_SUBJ e WINDOWS_IP (o valor será sobrescrito)
-include .env
export

# --- CONFIGURAÇÕES DO SISTEMA ---
VENV_NAME := venv
PYTHON := $(VENV_NAME)/bin/python
PIP := $(VENV_NAME)/bin/pip
REQUIREMENTS := requirements.txt

# --- DETECÇÃO AUTOMÁTICA DE IPS (O NOVO MÁGICO) ---
# 1. Pega o IP interno do Linux (WSL) para a ponte 'netsh'.
WSL_IP := $(shell hostname -I | cut -d' ' -f1)

# 2. Detecta o IP do Windows (Wi-Fi) usando ipconfig via PowerShell.
#    Busca o adaptador Wi-Fi e extrai o endereço IPv4.
WIN_IP := $(shell powershell.exe -Command "ipconfig" | grep "IPv4" | grep -A 3 "Wi-Fi" | tail -n 1 | awk '{print $$NF}' | tr -d '\r')

# --- REGRAS ---

# 1. Comando padrão: Configura rede, instala, gera certs e roda.
all: run

# 2. Regra principal: Garanta a ponte de rede antes de rodar
run: install certs bridge update-env
	@echo "=================================================="
	@echo ">>> INICIANDO SERVIDOR (Use Ctrl+C para parar) <<<"
	@echo "=================================================="
	$(PYTHON) app.py

# 3. CRIA A PONTE NO WINDOWS (Requer UAC/Admin)
bridge:
	@echo "--------------------------------------------------"
	@echo ">>> CONFIGURANDO REDE WINDOWS (Pode pedir senha) <<<"
	@echo ">>> WSL IP Detectado para ponte: $(WSL_IP)"
	@echo ">>> Criando ponte na porta 5000..."
	@powershell.exe -Command "Start-Process powershell -Verb RunAs -ArgumentList 'netsh interface portproxy add v4tov4 listenport=5000 listenaddress=0.0.0.0 connectport=5000 connectaddress=$(WSL_IP); New-NetFirewallRule -DisplayName \"Python Server\" -Direction Inbound -LocalPort 5000 -Protocol TCP -Action Allow -ErrorAction SilentlyContinue'"
	@echo ">>> Ponte configurada!"

# 4. ATUALIZA O .ENV (100% AUTOMÁTICO)
# Sobrescreve WINDOWS_IP com o IP Wi-Fi detectado (192.168.15.6)
update-env:
	@echo "--------------------------------------------------"
	@echo ">>> ATUALIZANDO .ENV COM NOVO IP DO WINDOWS: $(WIN_IP)"
	@# Substitui a linha WINDOWS_IP se existir, ou a adiciona se não existir.
	@if grep -q "^WINDOWS_IP=" .env; then \
		sed -i 's/^WINDOWS_IP=.*/WINDOWS_IP="$(WIN_IP)"/' .env; \
	else \
		echo 'WINDOWS_IP="$(WIN_IP)"' >> .env; \
	fi
	@echo ">>> IP EXTERNO CONFIGURADO PARA ACESSO MÓVEL"

# 5. Instalação do Python
install: $(VENV_NAME)/bin/activate

$(VENV_NAME)/bin/activate: $(REQUIREMENTS)
	@echo ">>> CRIANDO AMBIENTE VIRTUAL..."
	test -d $(VENV_NAME) || python3 -m venv $(VENV_NAME)
	@echo ">>> INSTALANDO DEPENDÊNCIAS..."
	$(PIP) install -r $(REQUIREMENTS)
	@touch $(VENV_NAME)/bin/activate

# 6. Certificados SSL (Geração)
certs: certs/cert.pem

certs/cert.pem:
	@echo ">>> GERANDO CERTIFICADOS SSL..."
	mkdir -p certs
	openssl req -x509 -newkey rsa:4096 -nodes \
		-out certs/cert.pem \
		-keyout certs/key.pem \
		-days 365 \
		-subj "$(if $(CERT_SUBJ),$(CERT_SUBJ),/CN=Localhost)"

# 7. Limpeza
clean:
	@echo ">>> LIMPANDO TUDO..."
	rm -rf $(VENV_NAME)
	rm -rf certs
	rm -rf __pycache__

.PHONY: all run install certs clean bridge update-env