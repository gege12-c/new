# Emails

Deux sortes d'emails :

- **Invitations d'un coach** : envoyées par le coach lui-même, depuis son téléphone (bouton « Envoyer (SMS, WhatsApp…) », partage du téléphone) ou sa messagerie (« Envoyer par email », message prêt avec le lien). Elles partent de son adresse, que l'athlète connaît : aucun réglage du site, rien qui finisse dans les indésirables. Le lien reste aussi à copier.
- **Emails du compte** (confirmation de l'adresse à l'inscription, mot de passe oublié, changement d'adresse) : envoyés par Supabase Auth. Sans service d'envoi (SMTP), Supabase ne les envoie qu'aux membres de l'organisation du projet ([Supabase, Send emails with custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)) : un athlète qui oublie son mot de passe ne reçoit rien. D'où la mise en place ci-dessous, une fois.

## Service d'envoi (SMTP), sans nom de domaine

Le plus simple : une adresse Gmail, avec un **mot de passe d'application** (Google l'exige pour les logiciels qui envoient par Gmail ; 500 emails par jour environ).

1. Compte Google : Sécurité, activez la **validation en deux étapes** si ce n'est pas fait.
2. Toujours dans Sécurité, « Mots de passe des applications » (ou https://myaccount.google.com/apppasswords) : créez-en un nommé « TriCoach », copiez les 16 lettres affichées. Ne les donnez à personne, pas même dans une conversation : elles se saisissent seulement dans Supabase.
3. Supabase, projet, **Authentication**, **Emails**, onglet **SMTP Settings**, « Enable custom SMTP » :
   - Sender email : votre adresse Gmail ; Sender name : `TriCoach`
   - Host : `smtp.gmail.com` ; Port : `465`
   - Username : votre adresse Gmail ; Password : le mot de passe d'application
   - Enregistrez.
4. Toujours dans **Emails**, onglet **Templates** : collez les modèles ci-dessous (objet et contenu), chacun dans son onglet, puis enregistrez.
5. **Authentication**, **Sign In / Providers**, Email : réactivez **Confirm email** (une adresse vérifiée à l'inscription).
6. Essai : sur le site, « Mot de passe oublié », avec votre adresse : l'email arrive, en français, et le lien ouvre la page du nouveau mot de passe, même sur un autre appareil.

Autre service possible, sans Gmail : Brevo (gratuit jusqu'à 300 emails par jour, expéditeur vérifié par un clic, sans domaine) : Host `smtp-relay.brevo.com`, Port `587`, identifiant et clé SMTP de Brevo.

## Modèles (Supabase, Authentication, Emails, Templates)

Les liens passent par `/auth/confirm` avec `token_hash` (forme recommandée par Supabase pour un site rendu côté serveur) : ils fonctionnent aussi sur un autre appareil que celui de la demande. `/auth/confirm` accepte toujours l'ancienne forme (`?code=`).

### Confirm signup

Objet : `Confirmez votre adresse TriCoach`

```html
<h2>Bienvenue sur TriCoach</h2>
<p>Pour activer votre compte, confirmez votre adresse :</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/home">Confirmer mon adresse</a></p>
<p>Si vous n'avez pas créé de compte, ignorez cet email.</p>
```

### Reset password

Objet : `Nouveau mot de passe TriCoach`

```html
<h2>Mot de passe oublié</h2>
<p>Pour choisir un nouveau mot de passe, ouvrez ce lien (valable une heure) :</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password">Choisir un nouveau mot de passe</a></p>
<p>Si vous n'avez rien demandé, ignorez cet email : votre mot de passe ne change pas.</p>
```

### Change email address

Objet : `Confirmez votre nouvelle adresse TriCoach`

```html
<h2>Changement d'adresse</h2>
<p>Pour utiliser {{ .NewEmail }} sur TriCoach, confirmez :</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email_change&next=/settings">Confirmer la nouvelle adresse</a></p>
<p>Si vous n'avez rien demandé, ignorez cet email.</p>
```

`{{ .SiteURL }}` est la *Site URL* de Supabase (Authentication, URL Configuration) : `https://new-bay-one-76.vercel.app`.
