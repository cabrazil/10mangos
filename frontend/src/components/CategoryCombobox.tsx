"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import { Search, ChevronDown, Check, X, Tag } from "lucide-react";

export interface CategoryOption {
  id: string;
  name: string;
  parentName?: string;
  fullName: string;
  color?: string;
}

interface CategoryComboboxProps {
  categories: Array<{
    id: string;
    name: string;
    type: string;
    color?: string;
    children?: Array<{ id: string; name: string; color?: string }>;
  }>;
  selectedId: string;
  onSelect: (categoryId: string) => void;
  placeholder?: string;
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function CategoryCombobox({
  categories,
  selectedId,
  onSelect,
  placeholder = "Buscar categoria ou subcategoria (ex: Condomínio, Supermercado)...",
}: CategoryComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Achatar categorias e subcategorias em uma lista única pesquisável
  const flatOptions = useMemo<CategoryOption[]>(() => {
    const list: CategoryOption[] = [];

    for (const cat of categories) {
      // Opção da categoria pai (geral)
      list.push({
        id: cat.id,
        name: cat.name,
        fullName: `${cat.name} (Geral)`,
        color: cat.color,
      });

      // Subcategorias
      if (cat.children && cat.children.length > 0) {
        for (const sub of cat.children) {
          list.push({
            id: sub.id,
            name: sub.name,
            parentName: cat.name,
            fullName: `${cat.name} > ${sub.name}`,
            color: sub.color || cat.color,
          });
        }
      }
    }

    return list;
  }, [categories]);

  // Item selecionado atualmente
  const selectedOption = useMemo(() => {
    return flatOptions.find((opt) => opt.id === selectedId);
  }, [flatOptions, selectedId]);

  // Filtrar com base na pesquisa
  const filteredOptions = useMemo(() => {
    if (!query.trim()) return flatOptions;
    const q = normalize(query);

    return flatOptions.filter((opt) => {
      const matchFull = normalize(opt.fullName).includes(q);
      const matchName = normalize(opt.name).includes(q);
      const matchParent = opt.parentName ? normalize(opt.parentName).includes(q) : false;
      return matchFull || matchName || matchParent;
    });
  }, [flatOptions, query]);

  // Fechar ao clicar fora
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSelect(id: string) {
    onSelect(id);
    setIsOpen(false);
    setQuery("");
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onSelect("");
    setQuery("");
  }

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Botão de disparo / Visualizador */}
      <div
        onClick={() => {
          setIsOpen(!isOpen);
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
        className={`w-full flex items-center justify-between bg-slate-950 border rounded-xl px-3.5 py-2.5 text-sm cursor-pointer transition-colors ${
          isOpen ? "border-emerald-500 ring-1 ring-emerald-500/20" : "border-slate-800 hover:border-slate-700"
        }`}
      >
        <div className="flex items-center gap-2 overflow-hidden text-ellipsis whitespace-nowrap">
          <Tag className="h-4 w-4 text-slate-500 flex-shrink-0" />
          {selectedOption ? (
            <div className="flex items-center gap-1.5 text-slate-100 font-medium">
              {selectedOption.parentName && (
                <span className="text-slate-400 font-normal text-xs">{selectedOption.parentName} &gt;</span>
              )}
              <span className="text-emerald-400 font-semibold">{selectedOption.name}</span>
            </div>
          ) : (
            <span className="text-slate-500 text-sm">{placeholder}</span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {selectedOption && (
            <button
              type="button"
              onClick={handleClear}
              className="p-1 rounded-md text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors"
              title="Remover categoria"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
        </div>
      </div>

      {/* Dropdown com campo de busca rápida */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 z-[70] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100 ring-1 ring-slate-700/50">
          {/* Campo de pesquisa instantânea */}
          <div className="p-2.5 border-b border-slate-800 bg-slate-950/90">
            <div className="relative flex items-center">
              <Search className="absolute left-3 h-4 w-4 text-slate-500" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Digite as iniciais ou nome (ex: cond, taba, inter)..."
                className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-8 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2.5 p-0.5 rounded text-slate-500 hover:text-slate-300"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Lista de opções filtradas */}
          <div className="max-h-72 overflow-y-auto divide-y divide-slate-800/40 p-1.5 space-y-0.5">
            <button
              type="button"
              onClick={() => handleSelect("")}
              className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg transition-colors ${
                !selectedId ? "bg-emerald-500/10 text-emerald-400 font-semibold" : "text-slate-400 hover:bg-slate-800/60"
              }`}
            >
              <span>Sem categoria</span>
              {!selectedId && <Check className="h-3.5 w-3.5 text-emerald-400" />}
            </button>

            {filteredOptions.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500">
                Nenhuma categoria encontrada para &quot;{query}&quot;
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = opt.id === selectedId;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleSelect(opt.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-xl text-left transition-colors ${
                      isSelected
                        ? "bg-emerald-500/15 text-emerald-300 font-semibold border border-emerald-500/20"
                        : "text-slate-200 hover:bg-slate-800 hover:text-white"
                    }`}
                  >
                    <div className="flex flex-col">
                      <div className="flex items-center gap-1.5">
                        {opt.parentName ? (
                          <>
                            <span className="text-slate-400 font-normal">{opt.parentName}</span>
                            <span className="text-slate-600">&gt;</span>
                            <span className="font-semibold text-slate-100">{opt.name}</span>
                          </>
                        ) : (
                          <span className="font-semibold text-slate-100">{opt.name}</span>
                        )}
                      </div>
                    </div>
                    {isSelected && <Check className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
