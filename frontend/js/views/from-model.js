// #/depuis-modele/12 : crée un projet à partir du modèle 12 de ModelFlow, puis l'ouvre.
// Le projet reprend le nom, le lien source, l'image et les thèmes du modèle et reste lié à lui.
import { api } from '../api.js';
import { toast } from '../ui.js';

export async function renderFromModel(el, modelId) {
  el.innerHTML = '<p class="loading">Création du projet depuis le modèle…</p>';
  const project = await api.post('projects/from-model', { model_id: Number(modelId) });
  toast(`Projet ${project.code} créé depuis le modèle ${project.model_code}`);
  // replace : un retour en arrière ou un rechargement ne recrée pas un second projet
  location.replace(`#/projet/${project.id}`);
}
