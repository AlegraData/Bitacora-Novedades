// Plantilla por defecto del correo de novedades. Es la plantilla de Alegra del
// Apps Script (index.html + lista <li> de templateEmail) pasada a Handlebars.
// Lo opcional va en bloques {{#if}}: si el campo no viene, no aparece (ni
// "undefined" ni links rotos). Se puede editar desde Admin → Correos.

export const TEMPLATE_KEY = 'novedad'

export const DEFAULT_SUBJECT = '{{#if tipo}}{{tipo}} | {{/if}}{{#if producto}}{{producto}} - {{/if}}{{titulo}}'

const LI = `font-family:'Inter', sans-serif;font-size: 17px; color: #64748b;line-height: 19px;line-height: 2;`
const LINK = `text-decoration: underline; color: #00b19d;`
const LINK_SPAN = `text-decoration: underline;text-decoration-color:#00b19d; color: #00b19d;`

export const DEFAULT_HTML = `<!DOCTYPE html>
<html>

<head>
  <base target="_top">
</head>

<body>
  <div>
    <div style="background-color:#F8FAFC;">
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter&family=Lexend:wght@700&display=swap');
      </style>
      <table width="650" border="0" align="center" cellpadding="0" cellspacing="0" style="padding:8px 0 0 0;border-radius: 4.3178px;">
        <tr>
          <td colspan="2" align="left" style="padding:50px 0 0 40px; background-color:#fff;">
            <img src="https://cdn1.alegra.com/websites/logo_alegra_new.png" style="border:none;outline:none;display:block;width: 180px;" alt="header">
          </td>
        </tr>
        <tr>
          <td colspan="2" align="left"
            style="padding:0px 40px 20px 40px; font-family:sans-serif; background-color:#fff;color:#595959;font-size:14px;line-height:20px;">
            <p style="line-height: 2; text-align: justify;">&nbsp;</p>
            <p
              style="text-align: justify; line-height: 97%; color: #00C8B1; font-wight: 700;font-size: 38px;font-family:'Lexend', sans-serif;">
              <strong>¡Hola equipo! 🙌</strong>
            </p>
            <p style="font-family:'Inter', sans-serif;text-align: justify; line-height: 2;">
              <span style="font-size: 17px; color: #64748b;line-height: 19px;">En esta oportunidad les traemos una comunicación{{#if tipo}} del tipo <strong>{{tipo}}</strong>{{/if}}{{#if producto}} de <strong>{{producto}}</strong>{{/if}}: <strong>{{titulo}}</strong></span>
            </p>
            <p style="text-align: justify; line-height: 2;">
              <span style="font-family:'Inter', sans-serif;font-size: 17px; color: #64748b;line-height: 19px;"><ul>
      {{#if descripcion}}<li style="${LI}">
        <strong>Descripción:</strong> {{descripcion}}</li>{{/if}}
      {{#if versiones}}<li style="${LI}">
        <strong>Versión:</strong> {{versiones}}</li>{{/if}}
      {{#if fecha}}<li style="${LI}">
        <strong>Fecha de lanzamiento:</strong> {{fecha}}</li>{{/if}}
      {{#if sh}}<li style="${LI}">
        <strong>Sh encargado:</strong> {{sh}}</li>{{/if}}
      {{#if responsables}}<li style="${LI}">
        <strong>Responsables:</strong> {{responsables}}</li>{{/if}}
      {{#if video}}<li style="${LI}">
        Puedes ver más en este <a href="{{video}}" rel="noopener" style="${LINK}"><span style="${LINK_SPAN}"><strong>Video / Ayuda</strong></span></a>.</li>{{/if}}
      <li style="${LI}">
        Mayor información en <a href="{{url}}" rel="noopener" style="${LINK}"><span style="${LINK_SPAN}"><strong>WikiAlegra 🌐</strong></span></a>.
      </li>
              </ul></span>
            </p>
            <p style="text-align: justify; line-height: 2;">
              <span style="font-family:'Inter', sans-serif;font-size: 17px; color: #64748b;line-height: 19px;">{{#if documentacion}}Les compartimos la <a href="{{documentacion}}" rel="noopener" style="${LINK}"><span style="${LINK_SPAN}"><strong>documentación</strong></span></a>
              para que puedan conocer más a detalle.
              {{/if}}Quedamos atentos a cualquier posible evento relacionado y les agradecemos por su tiempo.</span>
            </p>

            <p style="text-align:center; line-height: 2;padding-top:20px; ">
              <span style="font-family:'Inter', sans-serif;font-size: 17px;line-height: 19px; "><strong><span style="color: #64748b;">Saludos cordiales.</span></strong></span>
            </p>
          </td>
        </tr>
        <tr>
          <td height="20" colspan="2" align="center" style="font-family:sans-serif; color:#00B19D; font-size:14px;">
          </td>
        </tr>
        <tr width="600" style="background: #FFFFFF;">
          <td colspan="2" align="center">
            <table width="310" border="0" align="center" cellpadding="0" cellspacing="0" style="padding:30px 0 0 0;">
              <tr>
                <td width="45" align="center"><a href="https://twitter.com/AlegraWeb" target="_blank"><img src="https://cdn1.alegra.com/websites/footer_icono_twitter.png" style="border:none; outline:none;width: 45px;height: 45px;" alt="Twitter"></a></td>
                <td width="45" align="center"><a href="https://www.linkedin.com/company/alegra/" target="_blank"><img src="https://cdn1.alegra.com/websites/footer_icono_linkedin.png" style="border:none; outline:none;width: 45px;height: 45px;" alt="Linkedin"></a></td>
                <td width="45" align="center"><a href="https://www.instagram.com/alegraweb/" target="_blank"><img src="https://cdn1.alegra.com/websites/footer_icono_instagram.png" style="border:none; outline:none;width: 45px;height: 45px;" alt="Instagram"></a></td>
                <td width="45" align="center"><a href="https://www.facebook.com/alegra.web/" target="_blank"><img src="https://cdn1.alegra.com/websites/footer_icono_facebook.png" style="border:none; outline:none;width: 45px;height: 45px;" alt="Facebook"></a></td>
                <td width="45" align="center"><a href="https://www.tiktok.com/@alegraweb" target="_blank"><img src="https://cdn1.alegra.com/websites/footer_icono_tiktok.png" style="border:none; outline:none;width: 45px;height: 45px;" alt="TikTok"></a></td>
                <td width="45" align="center"><a href="https://www.youtube.com/user/AlegraWeb" target="_blank"><img src="https://cdn1.alegra.com/websites/footer_icono_youtube.png" style="border:none; outline:none;width: 45px;height: 45px;" alt="Youtube"></a></td>
              </tr>
            </table>
            <p
              style="text-align: justify; line-height: 2; font-family:'Inter', sans-serif;font-size: 16.2px;line-height: 19px;color: #64748b;text-align: center; padding-top:20px">
              Colombia - Medellín - Antioquia</p>
            <p
              style="text-align: justify; line-height: 2; font-family:'Inter', sans-serif;font-size: 16.5px;line-height: 19px;color: #64748B;text-align: center; padding:20px 0 30px 0">
              <strong>© Alegra</strong> - Todos los derechos reservados
            </p>
          </td>
        </tr>
        <tr>
          <td height="40" colspan="2" align="center" style="font-family:sans-serif; color:#B3B3B3; font-size:12px;">
          </td>
        </tr>
      </table>
    </div>
  </div>
</body>
</html>`
