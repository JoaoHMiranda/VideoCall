# --- CARREGA O .ENV ---
# O "-" no início serve para não dar erro fatal se o arquivo não existir,
# mas é essencial que ele exista para os certificados funcionarem.
-include .env
export

# --- CONFIGURAÇÕES DO SISTEMA ---
VENV_NAME := venv
PYTHON := $(VENV_NAME)/bin/python
PIP := $(VENV_NAME)/bin/pip
REQUIREMENTS := requirements.txt

# --- REGRAS ---

# 1. Comando padrão: Se você digitar apenas 'make'
all: run

# 2. Regra para rodar o servidor
run: install certs
	@echo "=================================================="
	@echo ">>> INICIANDO SERVIDOR (Use Ctrl+C para parar) <<<"
	@echo "=================================================="
	$(PYTHON) app.py

# 3. Regra para criar VENV e instalar bibliotecas
install: $(VENV_NAME)/bin/activate

$(VENV_NAME)/bin/activate: $(REQUIREMENTS)
	@echo ">>> CRIANDO AMBIENTE VIRTUAL (VENV)..."
	test -d $(VENV_NAME) || python3 -m venv $(VENV_NAME)
	@echo ">>> INSTALANDO DEPENDÊNCIAS..."
	$(PIP) install -r $(REQUIREMENTS)
	@touch $(VENV_NAME)/bin/activate

# 4. Regra para gerar os certificados usando a variável do .env
certs: certs/cert.pem

certs/cert.pem:
	@echo ">>> GERANDO CERTIFICADOS SSL USANDO DADOS DO .ENV..."
	@if [ -z "$(CERT_SUBJ)" ]; then \
		echo "ERRO: A variável CERT_SUBJ não foi encontrada no arquivo .env"; \
		exit 1; \
	fi
	mkdir -p certs
	openssl req -x509 -newkey rsa:4096 -nodes \
		-out certs/cert.pem \
		-keyout certs/key.pem \
		-days 365 \
		-subj $(CERT_SUBJ)

# 5. Regra de limpeza
clean:
	@echo ">>> LIMPANDO PROJETO..."
	rm -rf $(VENV_NAME)
	rm -rf certs
	rm -rf __pycache__
	rm -rf */__pycache__

.PHONY: all run install certs clean