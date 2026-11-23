"use client";

import React, { useState } from "react";
import { X, UploadCloud, FileSpreadsheet, CheckCircle2, AlertCircle, ArrowRight } from "lucide-react";

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: Array<{ id: string; name: string }>;
  onSuccess?: () => void;
}

export function ImportModal({ isOpen, onClose, accounts, onSuccess }: ImportModalProps) {
  const [selectedAccount, setSelectedAccount] = useState(accounts[0]?.id || "");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ inserted: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleImport() {
    if (!file || !selectedAccount) {
      alert("Selecione um arquivo e a conta de destino");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("accountId", selectedAccount);

    const token = localStorage.getItem("token");

    try {
      const res = await fetch("http://localhost:3333/api/imports/organizze-csv", {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao processar importação");

      setResult({ inserted: data.inserted, skipped: data.skipped });
      onSuccess?.();
    } catch (err: any) {
      setError(err.message || "Falha na importação");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <UploadCloud className="h-5 w-5 text-emerald-400" />
            Importar Extrato / Fatura de Cartão
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Conta Alvo */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-400">Conta de Destino</label>
            <select
              value={selectedAccount}
              onChange={(e) => setSelectedAccount(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          {/* Área de Upload / Dropzone */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-400">Arquivo (.xls, .xlsx, .csv ou .ofx)</label>
            <label className="border-2 border-dashed border-slate-800 hover:border-emerald-500/50 rounded-2xl p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors bg-slate-950/40">
              <FileSpreadsheet className="h-8 w-8 text-slate-400" />
              <div className="text-center">
                <span className="text-xs font-semibold text-emerald-400">Clique para selecionar</span>
                <span className="text-xs text-slate-500 block">ou arraste o extrato .ofx, fatura .xlsx ou planilha aqui</span>
              </div>
              {file && (
                <div className="mt-2 px-3 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs font-medium text-emerald-400">
                  {file.name}
                </div>
              )}
              <input
                type="file"
                accept=".xls,.xlsx,.csv,.ofx"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </label>
          </div>

          {/* Feedback de Resultado */}
          {result && (
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 space-y-1">
              <div className="flex items-center gap-2 font-bold text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                Importação Concluída!
              </div>
              <p>• {result.inserted} lançamentos inseridos com sucesso.</p>
              {result.skipped > 0 && <p>• {result.skipped} lançamentos já existentes foram ignorados.</p>}
            </div>
          )}

          {error && (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-rose-400 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Botões */}
          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            >
              Fechar
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={loading || !file}
              className="px-6 py-2.5 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-600 text-slate-950 shadow-md shadow-emerald-500/20 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 flex items-center gap-2"
            >
              {loading ? "Processando..." : "Importar Agora"}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
