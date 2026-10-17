"""Per-language cue words for spotting interview questions in languages other than English (live/multilingual.py).

Data only. English keeps its own, much larger tables in question_detector.py, untouched. Each table here is small on
purpose: the words and phrases an interviewer actually opens a question with, the acknowledgements that aren't
questions, and the endings that mean they haven't finished. Anything these miss but that still reads as a question (a
question mark, a question word) lands in the detector's uncertain band, where the model-backed classifier decides.

Phrases are written as people write them ("cuéntame", "parlez-moi de", "बताइए"); multilingual.py folds them the
same way it folds the transcript (case, accents for Latin scripts, ё, the Devanagari nukta), so "Cuentame" and
"cuéntame" match. Entries are separated by "|". A trailing "*" on a word matches any word starting with it.

Matching, per entry kind (see multilingual.Cues):
- start: at the start of a clause (after openers like "bueno", "also"). For SOV languages (Hindi, Hinglish,
  Japanese), where the verb and the question word come late, anywhere instead.
- contains: anywhere in the sentence.
- whole: the whole utterance (fillers, continuers).
- words: single words (filler words, trailing words, openers, guessing markers).
"""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class RawCues:
    code: str
    script: str  # latin | cyrillic | devanagari | japanese
    sov: bool = False  # verb-final: question words and requests anywhere, not at the start
    keep: str = ""  # accented letters not folded away ("où" isn't "ou", "è" isn't "e")
    wh: str = ""  # start: question words
    wh_marked: str = ""  # anywhere, as written with their accent (Spanish "cómo", never "como")
    wh_needs_mark: bool = False  # an unaccented question word counts only with a question mark
    aux: str = ""  # start: yes/no openers ("Können Sie", "est-ce que", "you have…?")
    particle: str = ""  # words: a yes/no particle within the first words (Russian "ли")
    endings: str = ""  # Japanese: sentence-final question endings ("ですか")
    request: str = ""  # start (strong) or anywhere (weaker): "tell me about", "explain"
    indirect: str = ""  # contains: "I'd like to know", "my question is"
    open_floor: str = ""  # contains: "any questions for us?"
    fillers: str = ""  # whole: acknowledgements and "one second"
    filler_words: str = ""  # words: an utterance of only these (≤ 3) is filler
    lead_fillers: str = ""  # words: dropped from the front before judging ("Bueno, ¿y la base de datos?")
    continuers: str = ""  # whole: "and then?", "why?" right after a question
    follow_up: str = ""  # contains: refers back to the previous answer
    trailing: str = ""  # words: a sentence ending on one of these isn't finished
    trailing_endings: str = ""  # Japanese: endings that mean it isn't finished ("けど")
    clause_breaks: str = ""  # words: where a turn's clauses split ("y", "also")
    openers: str = ""  # words: skipped at the start of a sentence
    new_topic: str = ""  # start: the interviewer moving on ("siguiente pregunta")
    lead_in: str = ""  # start: framing before the question ("hablemos de")
    check_ins: str = ""  # contains (short sentences): "can you hear me?", "does that make sense?"
    logistics: str = ""  # contains: screen sharing, mute, camera
    asides: str = ""  # contains: talk around the interview ("you cut out", "let me note that")
    reassurance: str = ""  # contains: "take your time"
    pleasantries: str = ""  # start: "thanks for joining"
    reaction: str = ""  # start (short sentences): the interviewer reacting to the last answer
    backchannel: str = ""  # contains: what a listening candidate says ("sí, claro"), not the start of an answer
    markers: str = ""  # words: common in this language and not in English, for telling the language of a line
    types: dict[str, str] = field(default_factory=dict)  # contains, per question type (as question_detector)
    size: dict[str, str] = field(default_factory=dict)  # contains, cues for the "auto" answer size (routing)


ES = RawCues(
    code="es", script="latin", wh_needs_mark=True,
    wh="qué|que|cómo|como|cuándo|cuando|dónde|donde|cuál|cual|cuáles|cuales|quién|quien|quiénes|cuánto|cuánta|"
       "cuántos|cuántas|por qué|para qué|en qué|de qué|con qué|a qué|adónde|desde cuándo",
    wh_marked="qué|cómo|cuándo|dónde|cuál|cuáles|quién|quiénes|cuánto|cuánta|cuántos|cuántas|adónde",
    aux="puedes|puede|podrías|podría|podrían|has|ha|tienes|tiene|sabes|sabe|conoces|conoce|estarías|estaría|"
        "te gustaría|le gustaría|quieres|quiere|prefieres|prefiere|crees|cree|harías|haría|usarías|usaría|"
        "es posible|hay algún|hay alguna|alguna vez",
    request="cuéntame|cuénteme|cuéntanos|cuéntenos|háblame|hábleme|háblanos|háblenos|explícame|explíqueme|"
            "explícanos|explica|explique|describe|describa|descríbeme|descríbame|dime|dígame|díganos|preséntate|"
            "preséntese|dame|deme|danos|muéstrame|muéstreme|escribe|escriba|implementa|implemente|diseña|diseñe|"
            "compara|compare|detalla|detalle|profundiza|profundice|desarrolla|desarrolle|resume|resuma|define|"
            "defina|menciona|mencione|enumera|enumere|calcula|calcule|resuelve|resuelva|optimiza|optimice|"
            "me puedes contar|me puede contar|me podrías contar|me podría contar|me puedes explicar|"
            "me puede explicar|me podrías explicar|me podría explicar|me gustaría que|quiero que|"
            "me cuentas|me cuentes|me explicas",
    indirect="me gustaría saber|quisiera saber|quiero saber|me interesa saber|me interesa conocer|"
             "me gustaría conocer|me gustaría escuchar|me gustaría entender|mi pregunta es|la pregunta es|"
             "quería preguntarte|quería preguntarle|quiero preguntarte|quiero preguntarle|te quería preguntar|"
             "le quería preguntar|tengo curiosidad|me da curiosidad",
    open_floor="alguna pregunta para|preguntas para mí|preguntas para nosotros|algo que quieras preguntar|"
               "algo que quiera preguntar|algo que te gustaría preguntar|algo que quieras añadir|algo más que añadir|"
               "tienes preguntas|tiene preguntas|tienes alguna pregunta|tiene alguna pregunta|alguna duda para",
    fillers="vale|bueno|bien|muy bien|perfecto|genial|claro|claro que sí|de acuerdo|gracias|muchas gracias|sí|no|"
            "ajá|entiendo|ya veo|exacto|exactamente|interesante|muy interesante|estupendo|excelente|okay|ok|"
            "vale vale|entendido|qué bien|qué interesante|qué bueno|por supuesto|sin problema|perfecto gracias|"
            "muy bien gracias|un momento|un segundo|dame un segundo|dame un momento|espera|espera un momento|"
            "adelante|hola|buenos días|buenas tardes|vale perfecto|muy bien perfecto|de nada|ya|claro claro",
    filler_words="vale|bueno|bien|ok|okay|sí|claro|genial|perfecto|gracias|ajá|eh|em|mm|mmm|este|pues|entonces|"
                 "ya|muy|exacto|interesante|estupendo|excelente|vaya",
    lead_fillers="vale|bueno|bien|ok|okay|sí|claro|genial|perfecto|gracias|eh|em|mm|este|pues|entonces|mira|oye|"
                 "ya|muy|exacto|interesante|estupendo",
    continuers="y|y luego|y después|por qué|cómo|cómo así|por ejemplo|como qué|qué más|algo más|sigue|continúa|"
               "adelante|y eso|y por qué|y cómo|en qué sentido|o sea|más|y entonces|por qué no|y qué más",
    follow_up="por qué hiciste|por qué elegiste|por qué decidiste|por qué no|qué pasó|y luego|y después|"
              "qué harías diferente|qué harías distinto|qué cambiarías|y el|y la|y los|y las|y tu|y su|y qué|y cómo|"
              "y por qué|más detalle|más sobre eso|ese proyecto|esa decisión|ese enfoque|esa base de datos|"
              "el equipo|el resultado|el proyecto|mirando atrás|en retrospectiva|cómo fue|cómo lo",
    trailing="y|o|pero|que|de|del|el|la|los|las|un|una|unos|unas|a|al|en|con|por|para|porque|como|sobre|mi|tu|su|"
             "nuestro|este|esta|ese|esa|cual|me|te|le|lo|se|sin|entre|hacia|desde|hasta|cuando|donde",
    clause_breaks="y|entonces|bueno|vale|ahora|pues|ok|okay|perfecto|genial",
    openers="entonces|bueno|vale|ok|okay|ahora|y|bien|pues|eh|este|mira|oye|perfecto|genial",
    new_topic="pasemos a|pasando a|vamos a pasar|cambiando de tema|cambiemos de tema|cambiamos de tema|"
              "siguiente pregunta|la siguiente pregunta|mi siguiente pregunta|la próxima pregunta|otra pregunta|"
              "una pregunta más|última pregunta|la última pregunta|ahora pasemos|ahora vamos a|"
              "para la siguiente parte|en la siguiente parte|para terminar",
    lead_in="hablemos de|vamos a hablar de|mencionaste|comentaste|veo que|vi que|en tu currículum|en tu cv|"
            "mirando tu|en tu último puesto|en tu empresa anterior|quiero preguntarte sobre|"
            "me gustaría preguntarte sobre|volviendo a|volvamos a|sobre el tema de|hablando de|"
            "esta pregunta es sobre|empecemos con|comencemos con|vamos a hacer una|hagamos una",
    check_ins="me escuchas|me escucha|me oyes|me oye|se me escucha|se me oye|me ves|me ve|ves mi pantalla|"
              "ve mi pantalla|se ve mi pantalla|tiene sentido|se entiende|está claro|queda claro|estás ahí|está ahí|"
              "sigues ahí|sigue ahí|necesitas un momento|necesita un momento|necesitas más tiempo|estás listo|"
              "estás lista|está listo|está lista|listo para empezar|empezamos|seguimos|continuamos|todo bien|"
              "te parece bien|le parece bien|alguna duda hasta ahora",
    logistics="compartir pantalla|comparte tu pantalla|comparta su pantalla|compartir tu pantalla|voy a compartir|"
              "déjame compartir|estás en silencio|está en silencio|enciende la cámara|activa la cámara|"
              "avísame cuando|avíseme cuando",
    asides="se cortó|se corta|se te corta|se congeló|mala conexión|mi internet|te perdí|voy a tomar nota|tomo nota|"
           "déjame anotar|estoy tomando notas",
    reassurance="tómate tu tiempo|tómese su tiempo|sin prisa|sin presión|no te preocupes|no se preocupe|"
                "cuando estés listo|cuando estés lista|cuando esté listo|piensa en voz alta|"
                "no hay respuesta incorrecta|no hay respuestas incorrectas",
    pleasantries="gracias por venir|gracias por tu tiempo|gracias por su tiempo|gracias por unirte|"
                 "encantado de conocerte|encantada de conocerte|mucho gusto|un placer|bienvenido|bienvenida|"
                 "buenos días|buenas tardes|buenas noches|hola",
    reaction="muy bien|bien|genial|perfecto|excelente|gracias|vale|ok|okay|de acuerdo|entendido|interesante|"
             "me gusta|qué bien|estupendo|claro|entiendo|tiene sentido|buena respuesta|buen punto",
    backchannel="sí|vale|claro|ok|okay|ajá|mm|mhm|eh|em|bueno|bien|entiendo|perfecto|exacto|de acuerdo|ya|y|pues|"
                "este|genial|gracias|correcto|por supuesto|totalmente|ya veo",
    markers="el|los|las|usted|ustedes|está|estás|es|son|una|unos|y|pero|muy|eso|esto|ese|esa|hay|cuéntame|háblame|"
            "también|puedes|tienes|qué|cómo|cuál|dónde|cuándo|por|para|del|al|lo|nos|tu|tú|su|sus|más|hacer|sobre|"
            "experiencia|trabajo|equipo|empresa|proyecto|cuando|porque|pregunta",
    types={
        "salary": "salario|sueldo|pretensiones salariales|pretensión salarial|expectativa salarial|"
                  "expectativas salariales|remuneración|compensación|cuánto quieres ganar|cuánto esperas ganar|"
                  "preaviso|periodo de preaviso",
        "clarification": "qué quieres decir|qué quiere decir|puedes aclarar|puede aclarar|puedes repetir|"
                         "puede repetir|repítelo|repita|a qué te refieres|a qué se refiere",
        "coding": "función|algoritmo|código|programa|escribe un|escriba un|implementa|implemente|complejidad|"
                  "arreglo|lista enlazada|árbol binario|cadena de texto|consulta sql|recursión|recursivo",
        "system_design": "diseñar un sistema|diseñarías|diseñaría|arquitectura|escalar|escalabilidad|"
                         "distribuido|alta disponibilidad|balanceador|microservicios|millones de usuarios",
        "resume": "háblame de ti|cuéntame de ti|cuéntame sobre ti|háblame sobre ti|preséntate|preséntese|"
                  "tu experiencia|su experiencia|tu trayectoria|su trayectoria|tu currículum|su currículum|tu cv|"
                  "tu último proyecto|tu puesto actual|tu formación|has trabajado con|ha trabajado con|has usado|"
                  "ha usado|un proyecto del que",
        "behavioral": "una vez que|una vez en que|una situación en la que|una situación donde|un momento en que|"
                      "conflicto|desacuerdo|fracaso|fallaste|error|orgulloso|orgullosa|difícil|desafío|reto|"
                      "presión|plazo|retroalimentación|fortaleza|fortalezas|debilidad|debilidades|priorizar",
        "leadership": "liderar un equipo|lideraste|liderazgo|mentor|gestionar personas|delegar|stakeholders|"
                      "partes interesadas|influir",
        "culture": "por qué quieres|por qué quiere|por qué esta empresa|por qué nosotros|por qué te vas|"
                   "por qué dejas|nuestra cultura|valores|dónde te ves|dónde se ve|qué te motiva|"
                   "por qué deberíamos contratarte|por qué este puesto|alguna pregunta para",
        "story": "cuéntame de una vez|cuéntame sobre una vez|háblame de una vez|describe una situación|"
                 "describe una vez|dame un ejemplo de una vez|una vez que|una vez en que|una situación en la que|"
                 "alguna vez has",
    },
    size={
        "brief": "en una palabra|en una frase|sí o no|pregunta rápida",
        "short": "brevemente|en resumen|en pocas palabras|a grandes rasgos|resumidamente|de forma breve|"
                 "versión corta|rápidamente",
        "deep": "en detalle|en profundidad|a fondo|paso a paso|detalladamente|de principio a fin|desde cero|"
                "con detalle",
        "define": "qué es|qué son|qué significa|a qué se refiere",
        "experience": "has usado|ha usado|has trabajado con|ha trabajado con|experiencia con|experiencia en|"
                      "conoces|conoce|has utilizado|ha utilizado",
        "approach": "cómo harías|cómo haría|qué harías|qué haría|cómo abordarías|cómo abordaría|cómo lo harías|"
                    "cómo resolverías|cómo manejarías|cómo manejaría|cuál sería tu enfoque|tu enfoque",
        "compare": "diferencia entre|diferencias entre|compara|compare|versus|vs|frente a",
        "explain": "explica|explique|describe|describa|cómo|por qué|cuéntame|háblame|ejemplo",
        "logistics": "cuándo puedes empezar|cuándo podrías empezar|cuándo puede empezar|fecha de inicio|preaviso|"
                     "incorporarte|incorporación",
        "intro": "háblame de ti|cuéntame de ti|cuéntame sobre ti|preséntate|preséntese|tu trayectoria|"
                 "tu currículum|tu experiencia profesional",
        "project": "un proyecto|tu último proyecto|tu proyecto|proyectos que",
        "open_floor": "alguna pregunta|preguntas para",
    },
)

PT = RawCues(
    code="pt", script="latin",
    wh="o que|que|como|por que|por quê|pra que|quando|onde|qual|quais|quem|quanto|quanta|quantos|quantas|"
       "de que|em que|para que|com que|aonde",
    aux="você pode|pode|poderia|você poderia|você já|já|você tem|tem|você sabe|sabe|você conhece|conhece|"
        "você está|você consegue|consegue|você gostaria|gostaria|você prefere|você acha|acha|você usaria|"
        "você faria|faria|é possível|existe|vocês",
    request="fale|fala|me fale|me fala|conte|conta|me conte|me conta|explique|explica|me explique|me explica|"
            "descreva|descreve|me descreva|apresente|se apresente|apresente se|dê um exemplo|me dê|me dá|mostre|"
            "mostra|me mostre|escreva|escreve|implemente|implementa|projete|projeta|compare|compara|detalhe|"
            "detalha|aprofunde|desenvolva|resuma|defina|define|liste|cite|calcule|resolva|otimize|"
            "você pode me contar|pode me contar|você poderia me contar|pode me explicar|você pode explicar|"
            "poderia explicar|gostaria que você",
    indirect="gostaria de saber|eu gostaria de saber|queria saber|eu queria saber|quero saber|"
             "gostaria de entender|gostaria de ouvir|minha pergunta é|a pergunta é|queria te perguntar|"
             "queria perguntar|quero perguntar|tenho curiosidade|estou curioso|estou curiosa|me interessa saber",
    open_floor="alguma pergunta para|perguntas para mim|perguntas para nós|perguntas pra mim|pra gente|"
               "alguma dúvida para|algo que queira perguntar|algo que você queira perguntar|algo a acrescentar|"
               "tem alguma pergunta|você tem alguma pergunta|tem perguntas",
    fillers="ok|tá|tá bom|tudo bem|beleza|certo|ótimo|legal|perfeito|entendi|entendido|obrigado|obrigada|"
            "muito obrigado|muito obrigada|sim|não|ah|hum|claro|claro que sim|show|muito bem|bom|combinado|"
            "exatamente|exato|interessante|que legal|que bom|faz sentido|com certeza|sem problemas|um momento|"
            "um segundo|só um momento|só um segundo|me dá um segundo|espera|olá|oi|bom dia|boa tarde|boa noite",
    filler_words="ok|tá|bom|certo|ótimo|legal|perfeito|sim|ah|hum|claro|show|beleza|então|entendi|obrigado|"
                 "obrigada|né|tipo|aí|exato|muito",
    lead_fillers="ok|tá|bom|certo|ótimo|legal|perfeito|sim|ah|hum|claro|show|beleza|então|olha|tipo|né|aí|exato",
    continuers="e|e depois|e então|por que|por quê|como assim|como|por exemplo|tipo o que|o que mais|"
               "mais alguma coisa|continue|continua|pode continuar|siga|e aí|e por que|e como|em que sentido|"
               "ou seja|mais|por que não",
    follow_up="por que você|por que escolheu|por que não|o que aconteceu|e depois|o que faria diferente|"
              "o que você faria diferente|o que mudaria|e o|e a|e os|e as|e o seu|e a sua|e o que|e como|"
              "e por que|mais detalhe|mais sobre isso|esse projeto|essa decisão|essa abordagem|esse banco de dados|"
              "a equipe|o time|o resultado|o projeto|olhando para trás|em retrospecto|como foi",
    trailing="e|ou|mas|que|de|do|da|dos|das|o|a|os|as|um|uma|uns|umas|em|no|na|nos|nas|com|por|pelo|pela|para|"
             "pra|se|porque|como|sobre|meu|minha|seu|sua|nosso|nossa|esse|essa|este|esta|qual|me|te|lhe|sem|entre|"
             "até|desde|quando|onde",
    clause_breaks="e|então|bom|ok|agora|beleza|certo|ótimo|legal|perfeito",
    openers="então|bom|ok|okay|agora|e|olha|tipo|aí|beleza|certo",
    new_topic="vamos para|passando para|vamos passar para|mudando de assunto|mudando de tema|próxima pergunta|"
              "a próxima pergunta|minha próxima pergunta|outra pergunta|mais uma pergunta|última pergunta|"
              "a última pergunta|vamos agora para|agora vamos para|na próxima parte|para a próxima parte|"
              "para terminar|para finalizar",
    lead_in="vamos falar sobre|vamos falar de|falando de|você mencionou|você comentou|vi que|vejo que|"
            "no seu currículo|olhando o seu|olhando seu|na sua última empresa|no seu último cargo|"
            "quero te perguntar sobre|gostaria de perguntar sobre|voltando a|voltando ao|sobre o tema|"
            "essa pergunta é sobre|vamos começar com|vamos começar por|vamos fazer uma",
    check_ins="está me ouvindo|você está me ouvindo|me ouve|consegue me ouvir|você consegue me ouvir|"
              "dá pra ouvir|está me vendo|consegue ver minha tela|vê minha tela|está vendo minha tela|faz sentido|"
              "ficou claro|está claro|tá claro|você está aí|ainda está aí|precisa de um minuto|"
              "precisa de um momento|precisa de mais tempo|está pronto|está pronta|pronto para começar|"
              "podemos começar|vamos começar|podemos seguir|podemos continuar|tudo bem até aqui|"
              "alguma dúvida até aqui|tudo certo",
    logistics="compartilhar a tela|compartilhar sua tela|compartilhe sua tela|compartilha a tela|vou compartilhar|"
              "deixa eu compartilhar|está no mudo|você está no mudo|tá no mudo|liga a câmera|ligar a câmera|"
              "abre a câmera|me avisa quando|me avise quando",
    asides="cortou|está cortando|travou|congelou|conexão ruim|minha internet|te perdi|vou anotar|deixa eu anotar|"
           "estou anotando|anotando aqui|tomando nota",
    reassurance="fique à vontade|fica à vontade|sem pressa|sem pressão|não se preocupe|quando estiver pronto|"
                "quando estiver pronta|pode pensar em voz alta|pense em voz alta|leve o tempo que precisar|"
                "não tem resposta errada",
    pleasantries="obrigado por vir|obrigada por vir|obrigado pelo seu tempo|obrigada pelo seu tempo|"
                 "obrigado por participar|prazer em conhecer|muito prazer|prazer|bem vindo|bem vinda|bom dia|"
                 "boa tarde|boa noite|olá|oi",
    reaction="muito bem|bem|ótimo|perfeito|excelente|obrigado|obrigada|ok|certo|beleza|entendi|legal|"
             "interessante|gostei|que bom|que legal|show|faz sentido|boa resposta|bom ponto",
    backchannel="sim|ok|tá|claro|certo|ah|hum|uhum|aham|é|e|bom|entendi|perfeito|exato|beleza|tipo|então|né|"
                "legal|obrigado|obrigada|com certeza|aí",
    markers="você|vocês|não|uma|um|da|dos|das|na|nos|nas|em|com|isso|isto|esse|essa|seu|sua|também|muito|mais|"
            "fale|conte|pode|tem|está|é|são|como|o|os|pra|já|meu|minha|trabalho|empresa|projeto|equipe|time|"
            "experiência|quando|onde|qual|quem|porque|então|aqui|ainda|pergunta|vez",
    types={
        "salary": "salário|pretensão salarial|expectativa salarial|remuneração|quanto você quer ganhar|"
                  "aviso prévio",
        "clarification": "o que você quer dizer|pode esclarecer|pode repetir|repete|como assim",
        "coding": "função|algoritmo|código|programa|escreva um|escreva uma|implemente|complexidade|vetor|"
                  "lista ligada|lista encadeada|árvore binária|consulta sql|recursão|recursivo",
        "system_design": "projetar um sistema|projetaria|desenharia|arquitetura|escalar|escalabilidade|"
                         "distribuído|alta disponibilidade|balanceador|microsserviços|milhões de usuários",
        "resume": "fale sobre você|fala sobre você|me fale sobre você|me conte sobre você|se apresente|"
                  "apresente se|sua experiência|sua trajetória|seu currículo|seu último projeto|seu cargo atual|"
                  "sua formação|já trabalhou com|já usou|um projeto do qual",
        "behavioral": "uma vez em que|uma vez que você|uma situação em que|um momento em que|conflito|"
                      "discordância|fracasso|falhou|erro|orgulho|orgulhoso|difícil|desafio|pressão|prazo|feedback|"
                      "ponto forte|pontos fortes|ponto fraco|pontos fracos|priorizar",
        "leadership": "liderar uma equipe|liderar um time|liderou|liderança|mentor|delegar|stakeholders|influenciar",
        "culture": "por que você quer|por que esta empresa|por que essa empresa|por que nós|por que está saindo|"
                   "nossa cultura|valores|onde você se vê|o que te motiva|por que devemos contratar|"
                   "por que esta vaga|por que essa vaga|alguma pergunta para",
        "story": "me conte sobre uma vez|conte sobre uma vez|fale sobre uma vez|descreva uma situação|"
                 "me dê um exemplo de uma vez|uma vez em que|uma situação em que|alguma vez você",
    },
    size={
        "brief": "em uma palavra|numa palavra|em uma frase|sim ou não|pergunta rápida",
        "short": "brevemente|em resumo|resumidamente|em poucas palavras|rapidamente|de forma breve|por alto",
        "deep": "em detalhe|em detalhes|a fundo|em profundidade|passo a passo|detalhadamente|do início ao fim|"
                "do zero",
        "define": "o que é|o que são|o que significa",
        "experience": "já usou|já trabalhou com|experiência com|experiência em|conhece|você usa",
        "approach": "como você faria|o que você faria|como abordaria|como você resolveria|como lidaria|"
                    "qual seria sua abordagem|sua abordagem",
        "compare": "diferença entre|diferenças entre|compare|compara|versus|vs",
        "explain": "explique|explica|descreva|como|por que|conte|fale|exemplo",
        "logistics": "quando pode começar|quando você pode começar|data de início|aviso prévio",
        "intro": "fale sobre você|me fale sobre você|me conte sobre você|se apresente|sua trajetória|seu currículo",
        "project": "um projeto|seu último projeto|seu projeto|projetos que",
        "open_floor": "alguma pergunta|perguntas para",
    },
)

FR = RawCues(
    code="fr", script="latin", keep="ù",
    wh="comment|pourquoi|quand|où|quel|quelle|quels|quelles|qui|que|qu est ce que|qu est ce qui|quoi|combien|"
       "lequel|laquelle|lesquels|lesquelles|à quel|à quelle|de quel|de quelle|dans quel|dans quelle|pour quel|"
       "en quoi|à quoi|de quoi|par quoi|d où",
    aux="est ce que|est ce qu|pouvez vous|pourriez vous|avez vous|êtes vous|seriez vous|savez vous|"
        "connaissez vous|as tu|peux tu|pourrais tu|es tu|sais tu|connais tu|y a t il|vous avez|vous pouvez|"
        "vous êtes|tu as|tu peux|aimeriez vous|voudriez vous|voulez vous|préférez vous|utilisez vous|"
        "feriez vous|auriez vous|ça vous",
    request="parlez moi|parle moi|parlez nous|parle nous|racontez moi|raconte moi|racontez nous|expliquez|"
            "explique|expliquez moi|explique moi|expliquez nous|décrivez|décris|décrivez moi|présentez vous|"
            "présente toi|donnez moi|donne moi|donnez nous|montrez moi|montre moi|dites moi|dis moi|dites nous|"
            "citez|comparez|concevez|implémentez|implémente|écrivez|écris|détaillez|développez|résumez|"
            "définissez|listez|calculez|résolvez|optimisez|pouvez vous me|pourriez vous me|peux tu me|"
            "pourrais tu me|j aimerais que vous|j aimerais que tu",
    indirect="j aimerais savoir|j aimerais comprendre|j aimerais entendre|je voudrais savoir|"
             "je voudrais comprendre|je veux savoir|ma question est|ma question c est|la question est|"
             "je voulais vous demander|je voulais te demander|je voudrais vous demander|je suis curieux|"
             "je suis curieuse|je me demandais|ça m intéresse de savoir",
    open_floor="des questions pour moi|des questions pour nous|questions pour moi|questions pour nous|"
               "avez vous des questions|as tu des questions|vous avez des questions|tu as des questions|"
               "quelque chose à ajouter|quelque chose que vous aimeriez demander|une question pour nous",
    fillers="d accord|ok|okay|très bien|bien|parfait|super|génial|merci|merci beaucoup|oui|non|ah|euh|hum|"
            "je vois|entendu|bien sûr|exactement|intéressant|très intéressant|bon|voilà|ça marche|c est noté|"
            "pas de souci|pas de problème|un instant|une seconde|un moment|attendez|donnez moi une seconde|"
            "bonjour|salut|c est clair|c est parfait|c est super|excellent|ouais|ah oui|ah d accord|tout à fait|"
            "effectivement|absolument|oui oui|d accord merci|très bien merci",
    filler_words="ok|okay|bien|bon|parfait|super|génial|merci|oui|ah|euh|hum|voilà|alors|donc|ouais|d|accord|très|"
                 "effectivement|absolument|exactement|ben|excellent",
    lead_fillers="ok|okay|bien|bon|parfait|super|génial|merci|oui|ah|euh|hum|voilà|alors|donc|ouais|ben|bah|"
                 "enfin|effectivement|absolument|exactement|d|accord",
    continuers="et|et ensuite|et après|et puis|pourquoi|comment|comment ça|par exemple|comme quoi|quoi d autre|"
               "autre chose|continuez|continue|allez y|et alors|et pourquoi|et comment|c est à dire|"
               "dans quel sens|plus|pourquoi pas|et donc",
    follow_up="pourquoi avez vous|pourquoi as tu|pourquoi ce|pourquoi pas|qu est ce qui s est passé|"
              "que s est il passé|et ensuite|et après|que feriez vous différemment|"
              "qu est ce que vous feriez différemment|que changeriez vous|et le|et la|et les|et votre|et ton|"
              "et ta|et que|et comment|et pourquoi|plus de détails|plus sur|ce projet|cette décision|"
              "cette approche|cette base de données|l équipe|le résultat|le projet|avec le recul|"
              "rétrospectivement",
    trailing="et|ou|mais|donc|de|du|des|le|la|les|l|un|une|à|au|aux|pour|avec|sur|dans|par|que|qu|qui|si|parce|"
             "comme|en|mon|ma|mes|ton|ta|votre|vos|notre|nos|ce|cette|ces|quel|quelle|d|sans|entre|vers|chez|quand",
    clause_breaks="et|alors|donc|bon|ok|okay|maintenant|parfait|super",
    openers="alors|donc|bon|ok|okay|maintenant|et|ben|euh|bien|voilà",
    new_topic="passons à|on passe à|changeons de sujet|changement de sujet|question suivante|"
              "la question suivante|prochaine question|ma prochaine question|une autre question|"
              "encore une question|dernière question|la dernière question|passons maintenant|maintenant passons|"
              "pour la prochaine partie|dans la partie suivante|pour terminer|pour finir",
    lead_in="parlons de|on va parler de|vous avez mentionné|vous avez parlé de|tu as mentionné|je vois que|"
            "j ai vu que|sur votre cv|dans votre cv|en regardant votre|dans votre dernier poste|"
            "dans votre entreprise précédente|je voudrais vous interroger sur|je voudrais parler de|revenons à|"
            "pour revenir à|à propos de|en parlant de|cette question porte sur|commençons par|faisons un|"
            "faisons une",
    check_ins="vous m entendez|tu m entends|vous m entendez bien|on m entend|vous me voyez|vous voyez mon écran|"
              "tu vois mon écran|ça a du sens|c est clair|est ce clair|c est clair pour vous|vous êtes là|"
              "tu es là|vous avez besoin d une minute|besoin d un moment|besoin de plus de temps|vous êtes prêt|"
              "vous êtes prête|tu es prêt|prêt à commencer|on commence|on peut commencer|on peut continuer|"
              "on continue|on passe à la suite|ça vous va|ça te va|tout va bien|des questions jusqu ici",
    logistics="partager votre écran|partager ton écran|partager mon écran|partagez votre écran|"
              "partage ton écran|je vais partager|laissez moi partager|vous êtes en sourdine|tu es en sourdine|"
              "vous êtes en muet|activez votre caméra|allumez votre caméra|dites moi quand|prévenez moi quand",
    asides="ça coupe|vous coupez|ça a coupé|ça a figé|mauvaise connexion|ma connexion|je vous ai perdu|"
           "je prends note|je note|laissez moi noter|je prends des notes",
    reassurance="prenez votre temps|prends ton temps|pas de pression|rien ne presse|ne vous inquiétez pas|"
                "quand vous êtes prêt|quand vous êtes prête|quand tu es prêt|réfléchissez à voix haute|"
                "n hésitez pas à réfléchir|il n y a pas de mauvaise réponse|allez y",
    pleasantries="merci d être venu|merci d être venue|merci d être là|merci pour votre temps|"
                 "merci de votre temps|merci de nous rejoindre|ravi de vous rencontrer|ravie de vous rencontrer|"
                 "enchanté|enchantée|bienvenue|bonjour|bonsoir|salut",
    reaction="très bien|bien|parfait|excellent|super|génial|merci|d accord|ok|entendu|intéressant|"
             "c est intéressant|j aime bien|bonne réponse|bon point|c est clair|je vois",
    backchannel="oui|ouais|ok|okay|d accord|ah|euh|hum|mm|bon|bien|voilà|alors|donc|ben|exactement|absolument|"
                "effectivement|tout à fait|je vois|parfait|super|merci|entendu|bien sûr",
    markers="vous|est|les|des|une|pour|que|qui|avez|êtes|comment|pourquoi|quel|quelle|votre|vos|le|et|dans|c|qu|"
            "j|d|l|pas|avec|sur|ce|cette|mon|ma|je|nous|être|faire|très|aussi|mais|où|parlez|expliquez|décrivez|"
            "projet|équipe|entreprise|expérience|travail|ça|du|au|aux|est ce",
    types={
        "salary": "salaire|rémunération|prétentions salariales|prétention salariale|attentes salariales|préavis",
        "clarification": "que voulez vous dire|qu entendez vous par|pouvez vous préciser|pouvez vous répéter|"
                         "tu peux répéter|reformuler",
        "coding": "fonction|algorithme|code|programme|écrivez un|écrivez une|implémentez|complexité|tableau|"
                  "liste chaînée|arbre binaire|chaîne de caractères|requête sql|récursion|récursif",
        "system_design": "concevoir un système|concevriez|concevrais|architecture|mise à l échelle|scalabilité|"
                         "distribué|haute disponibilité|répartiteur de charge|microservices|millions d utilisateurs",
        "resume": "parlez moi de vous|parle moi de toi|présentez vous|présente toi|votre parcours|ton parcours|"
                  "votre expérience|ton expérience|votre cv|ton cv|votre dernier projet|votre poste actuel|"
                  "votre formation|avez vous travaillé avec|avez vous utilisé|un projet dont",
        "behavioral": "une fois où|une situation où|un moment où|conflit|désaccord|échec|échoué|erreur|fier|fière|"
                      "difficile|défi|pression|délai|retour|point fort|points forts|qualité|défaut|point faible|"
                      "points faibles|prioriser",
        "leadership": "diriger une équipe|dirigé une équipe|leadership|mentor|manager une équipe|déléguer|"
                      "parties prenantes|influencer",
        "culture": "pourquoi voulez vous|pourquoi veux tu|pourquoi notre entreprise|pourquoi nous|"
                   "pourquoi quittez vous|pourquoi partez vous|notre culture|valeurs|où vous voyez vous|"
                   "qu est ce qui vous motive|pourquoi devrions nous vous embaucher|pourquoi ce poste|"
                   "des questions pour",
        "story": "parlez moi d une fois|racontez moi une fois|décrivez une situation|donnez moi un exemple d une fois|"
                 "une fois où|une situation où|avez vous déjà",
    },
    size={
        "brief": "en un mot|en une phrase|oui ou non|question rapide",
        "short": "brièvement|en bref|en résumé|en quelques mots|rapidement|dans les grandes lignes|"
                 "version courte",
        "deep": "en détail|en profondeur|étape par étape|de bout en bout|à partir de zéro|dans le détail",
        "define": "qu est ce que|qu est ce qu|que signifie|c est quoi",
        "experience": "avez vous utilisé|avez vous travaillé avec|avez vous déjà utilisé|expérience avec|"
                      "connaissez vous|tu as utilisé|tu connais",
        "approach": "comment feriez vous|que feriez vous|comment aborderiez vous|comment vous y prendriez vous|"
                    "comment géreriez vous|comment résoudriez vous|votre approche",
        "compare": "différence entre|différences entre|comparez|versus|vs|par rapport à",
        "explain": "expliquez|explique|décrivez|comment|pourquoi|parlez|racontez|exemple",
        "logistics": "quand pouvez vous commencer|date de début|disponibilité|préavis",
        "intro": "parlez moi de vous|présentez vous|votre parcours|votre cv",
        "project": "un projet|votre dernier projet|votre projet|projets que",
        "open_floor": "des questions|questions pour",
    },
)

DE = RawCues(
    code="de", script="latin",
    wh="was|wie|warum|wieso|weshalb|wann|wo|woher|wohin|welche|welcher|welches|welchen|welchem|wer|wen|wem|"
       "wessen|wie viel|wie viele|wieviel|womit|wofür|worauf|worüber|worum|wodurch|inwiefern|in welchem|"
       "in welcher|mit welchem|mit welcher|bei welchem|für welche|an welchem|aus welchem",
    aux="können|könnten|kannst|konntest|haben|hatten|hast|hattest|hätten|sind|waren|bist|warst|ist|war|würden|"
        "würdest|werden|wirst|wird|möchten|möchtest|wollen|willst|sollten|solltest|dürfen|darf|gibt|kennen|"
        "kennst|nutzen|nutzt|verwenden|verwendest|arbeiten|arbeitest|wissen|weißt|finden|findest|machen|machst|"
        "glauben|glaubst|denken|denkst|magst|mögen",
    request="erzählen sie|erzähl|erzähle|erklären sie|erklär|erkläre|beschreiben sie|beschreib|beschreibe|"
            "stellen sie sich|stell dich|geben sie|gib|nennen sie|nenn|nenne|zeigen sie|zeig|zeige|schreiben sie|"
            "schreib|schreibe|implementieren sie|implementiere|entwerfen sie|entwirf|vergleichen sie|vergleiche|"
            "skizzieren sie|skizziere|fassen sie|definieren sie|definiere|berechnen sie|berechne|lösen sie|löse|"
            "optimieren sie|optimiere|führen sie|gehen sie|sagen sie|sag|berichten sie|schildern sie|schildere|"
            "begründen sie|erläutern sie|erläutere",
    indirect="ich würde gerne wissen|ich möchte wissen|ich möchte gerne wissen|ich will wissen|"
             "mich würde interessieren|mich interessiert|meine frage ist|die frage ist|ich wollte sie fragen|"
             "ich wollte dich fragen|ich möchte sie fragen|ich bin neugierig|ich frage mich|"
             "ich würde gerne hören|ich würde gerne verstehen",
    open_floor="fragen an mich|fragen an uns|haben sie fragen|haben sie noch fragen|hast du fragen|"
               "hast du noch fragen|noch fragen|etwas hinzufügen|etwas zu ergänzen|möchten sie noch etwas fragen|"
               "gibt es noch fragen",
    fillers="okay|ok|gut|sehr gut|alles klar|klar|super|prima|genau|danke|vielen dank|danke schön|ja|nein|aha|hm|"
            "hmm|ich verstehe|verstehe|verstanden|interessant|sehr interessant|stimmt|richtig|perfekt|toll|schön|"
            "na gut|in ordnung|einen moment|eine sekunde|moment|kleinen moment|warten sie|hallo|guten tag|"
            "guten morgen|kein problem|gerne|sicher|natürlich|ach so|ja genau|ja klar|okay danke|gut danke",
    filler_words="okay|ok|gut|klar|super|prima|genau|danke|ja|aha|hm|hmm|also|so|na|sehr|alles|perfekt|toll|"
                 "richtig|stimmt|schön|ah|äh|ähm|eh|ehm",
    lead_fillers="okay|ok|gut|klar|super|prima|genau|danke|ja|aha|hm|also|so|na|nun|perfekt|toll|richtig|stimmt|"
                 "ah|äh|ähm|eh|ehm",
    continuers="und|und dann|und danach|warum|wieso|wie|wie meinen sie das|zum beispiel|wie zum beispiel|"
               "was noch|noch etwas|sonst noch etwas|weiter|machen sie weiter|fahren sie fort|erzählen sie weiter|"
               "und warum|und wie|inwiefern|das heißt|mehr|warum nicht|und weiter",
    follow_up="warum haben sie|warum hast du|warum nicht|was ist passiert|und dann|was würden sie anders machen|"
              "was würden sie heute anders|und der|und die|und das|und ihre|und ihr|und was|und wie|und warum|"
              "mehr details|mehr dazu|dieses projekt|diese entscheidung|dieser ansatz|diesen ansatz|"
              "diese datenbank|das team|das ergebnis|das projekt|im rückblick|rückblickend",
    trailing="und|oder|aber|dass|weil|wenn|ob|der|die|das|den|dem|des|ein|eine|einen|einem|einer|zu|mit|von|für|"
             "auf|in|an|bei|um|über|nach|aus|ihr|ihre|ihren|ihrem|mein|meine|unser|unsere|dein|deine|welche|sich|als",
    clause_breaks="und|also|okay|ok|gut|nun|jetzt|prima|super",
    openers="also|so|okay|ok|gut|nun|jetzt|und|na|ja",
    new_topic="kommen wir zu|gehen wir über zu|nächste frage|die nächste frage|meine nächste frage|"
              "eine andere frage|noch eine frage|letzte frage|die letzte frage|themenwechsel|"
              "wechseln wir das thema|wechseln wir zu|jetzt zu|nun zu|für den nächsten teil|im nächsten teil|"
              "zum schluss|zum abschluss",
    lead_in="lassen sie uns über|lass uns über|sprechen wir über|reden wir über|sie haben erwähnt|sie erwähnten|"
            "du hast erwähnt|ich sehe|ich habe gesehen|in ihrem lebenslauf|laut ihrem lebenslauf|"
            "wenn ich mir ihren|in ihrer letzten rolle|bei ihrem letzten arbeitgeber|zurück zu|apropos|"
            "diese frage betrifft|fangen wir mit|beginnen wir mit|machen wir eine",
    check_ins="hören sie mich|hörst du mich|können sie mich hören|kannst du mich hören|sehen sie mich|"
              "sehen sie meinen bildschirm|siehst du meinen bildschirm|ergibt das sinn|macht das sinn|"
              "ist das klar|ist das verständlich|sind sie noch da|bist du noch da|brauchen sie einen moment|"
              "brauchen sie noch zeit|brauchst du einen moment|sind sie bereit|bist du bereit|"
              "können wir anfangen|können wir beginnen|können wir weitermachen|sollen wir weitermachen|"
              "machen wir weiter|alles gut|passt das|ist das okay|ist das in ordnung|bisher fragen",
    logistics="bildschirm teilen|ihren bildschirm teilen|deinen bildschirm teilen|ich teile meinen bildschirm|"
              "teilen sie ihren bildschirm|sie sind stumm|sie sind auf stumm|du bist stumm|kamera einschalten|"
              "schalten sie ihre kamera|sagen sie bescheid|geben sie bescheid",
    asides="sie sind abgehackt|schlechte verbindung|die verbindung|mein internet|eingefroren|"
           "ich habe sie verloren|ich mache mir eine notiz|ich notiere|ich schreibe mit|notiere mir",
    reassurance="nehmen sie sich zeit|lassen sie sich zeit|nimm dir zeit|kein stress|kein druck|keine eile|"
                "keine sorge|wenn sie bereit sind|wenn du bereit bist|denken sie laut|sie können laut denken|"
                "es gibt keine falsche antwort",
    pleasantries="danke dass sie|danke für ihre zeit|schön sie kennenzulernen|freut mich|herzlich willkommen|"
                 "willkommen|guten tag|guten morgen|hallo",
    reaction="sehr gut|gut|super|prima|perfekt|toll|danke|vielen dank|okay|ok|alles klar|verstanden|interessant|"
             "das ist interessant|gute antwort|guter punkt|das klingt gut|ich verstehe|genau",
    backchannel="ja|okay|ok|genau|klar|gut|also|so|ah|äh|ähm|ehm|hm|mhm|aha|richtig|stimmt|sicher|natürlich|super|"
                "danke|und|na|eben",
    markers="sie|ist|und|die|der|das|wie|warum|ihre|ihr|haben|können|mit|ein|eine|nicht|ich|wir|auch|für|auf|"
            "von|zu|dem|den|des|sich|bei|oder|aber|noch|schon|mal|erzählen|erklären|welche|wann|wo|gibt|sind|"
            "werden|würden|projekt|erfahrung|arbeit|unternehmen|frage|hat|haben|einen|einem|ihrem|ihren",
    types={
        "salary": "gehalt|gehaltsvorstellung|gehaltsvorstellungen|vergütung|kündigungsfrist|was möchten sie verdienen",
        "clarification": "was meinen sie|wie meinen sie|können sie das wiederholen|können sie das präzisieren|"
                         "noch einmal sagen",
        "coding": "funktion|algorithmus|code|programm|schreiben sie eine|schreiben sie einen|implementieren|"
                  "komplexität|array|verkettete liste|binärbaum|zeichenkette|sql abfrage|rekursion|rekursiv",
        "system_design": "system entwerfen|ein system|würden sie entwerfen|architektur|skalieren|skalierbarkeit|"
                         "verteilt|hochverfügbarkeit|lastverteilung|microservices|millionen nutzer",
        "resume": "erzählen sie etwas über sich|etwas über sich|erzählen sie von sich|stellen sie sich vor|"
                  "stell dich vor|"
                  "ihr werdegang|ihren werdegang|ihre erfahrung|ihr lebenslauf|ihren lebenslauf|"
                  "ihr letztes projekt|ihre aktuelle rolle|ihre aktuelle position|ihr studium|haben sie mit|"
                  "ein projekt auf das",
        "behavioral": "eine situation|ein mal als|ein beispiel als|als sie|konflikt|meinungsverschiedenheit|"
                      "misserfolg|gescheitert|fehler|stolz|schwierig|herausforderung|druck|frist|deadline|feedback|"
                      "stärke|stärken|schwäche|schwächen|priorisieren",
        "leadership": "team führen|ein team geleitet|führung|mentor|delegieren|stakeholder|beeinflussen",
        "culture": "warum möchten sie|warum wollen sie|warum unser unternehmen|warum wir|warum wechseln sie|"
                   "warum verlassen sie|unsere kultur|werte|wo sehen sie sich|was motiviert sie|"
                   "warum sollten wir sie einstellen|warum diese stelle|fragen an uns",
        "story": "erzählen sie von einer situation|erzählen sie mir von einer situation|beschreiben sie eine situation|"
                 "geben sie ein beispiel|eine situation in der|ein mal als|haben sie schon einmal",
    },
    size={
        "brief": "in einem wort|in einem satz|ja oder nein|kurze frage",
        "short": "kurz|in kürze|zusammengefasst|kurz gesagt|in wenigen worten|grob|überblick",
        "deep": "im detail|ausführlich|detailliert|schritt für schritt|von anfang bis ende|von grund auf|"
                "in der tiefe",
        "define": "was ist|was sind|was bedeutet|was versteht man unter",
        "experience": "haben sie erfahrung|erfahrung mit|haben sie schon mit|haben sie mit|kennen sie|kennst du|"
                      "nutzen sie",
        "approach": "wie würden sie|was würden sie tun|wie gehen sie vor|wie würden sie vorgehen|"
                    "wie würden sie das lösen|ihr ansatz|ihren ansatz",
        "compare": "unterschied zwischen|unterschiede zwischen|vergleichen sie|versus|vs|im vergleich zu",
        "explain": "erklären|erklär|beschreiben|wie|warum|erzählen|beispiel",
        "logistics": "wann können sie anfangen|wann könnten sie anfangen|eintrittsdatum|kündigungsfrist",
        "intro": "erzählen sie etwas über sich|stellen sie sich vor|ihr werdegang|ihr lebenslauf",
        "project": "ein projekt|ihr letztes projekt|ihr projekt|projekte die",
        "open_floor": "fragen an|noch fragen",
    },
)

IT = RawCues(
    code="it", script="latin", keep="è",
    wh="che|cosa|che cosa|come|perché|quando|dove|quale|quali|chi|quanto|quanta|quanti|quante|in che modo|"
       "in che|di che|per quale|con quale|a che|da dove|da quanto|qual è",
    aux="può|potrebbe|puoi|potresti|ha|hai|ha mai|hai mai|è|sei|sa|sai|conosce|conosci|avete|siete|vorrebbe|"
        "vorresti|preferisce|preferisci|pensa|pensi|crede|credi|userebbe|useresti|farebbe|faresti|c è|ci sono|"
        "esiste",
    request="mi parli|mi parli di|parlami|ci parli|parlaci|mi racconti|raccontami|ci racconti|raccontaci|"
            "mi spieghi|spiegami|spieghi|spiega|ci spieghi|descriva|descrivi|mi descriva|mi descrivi|si presenti|"
            "presentati|mi dia|dammi|mi faccia un esempio|fammi un esempio|mi fai un esempio|mostrami|mi mostri|"
            "scriva|scrivi|implementi|implementa|progetti|progetta|confronti|confronta|approfondisca|approfondisci|"
            "sviluppi|riassuma|riassumi|definisca|definisci|elenchi|elenca|calcoli|calcola|risolva|risolvi|"
            "ottimizzi|ottimizza|mi può|mi potrebbe|mi puoi|mi potresti|vorrei che",
    indirect="vorrei sapere|mi piacerebbe sapere|vorrei capire|mi piacerebbe capire|vorrei sentire|"
             "mi interessa sapere|mi interesserebbe sapere|la mia domanda è|la domanda è|volevo chiederle|"
             "volevo chiederti|vorrei chiederle|vorrei chiederti|sono curioso|sono curiosa|mi chiedevo",
    open_floor="domande per me|domande per noi|ha domande|hai domande|ha qualche domanda|hai qualche domanda|"
               "qualcosa da chiedere|qualcosa da aggiungere|vuole chiedermi|vuoi chiedermi|vuole aggiungere",
    fillers="ok|okay|va bene|bene|molto bene|perfetto|ottimo|certo|certo certo|grazie|grazie mille|sì|no|ah|ehm|mm|"
            "capisco|ho capito|esatto|esattamente|interessante|molto interessante|d accordo|giusto|benissimo|"
            "un attimo|un momento|un secondo|aspetti|aspetta|ciao|buongiorno|buonasera|nessun problema|"
            "senz altro|ah ok|ah sì|bello|chiaro|certamente|assolutamente",
    filler_words="ok|okay|bene|perfetto|ottimo|certo|grazie|sì|ah|ehm|mm|allora|quindi|dunque|va|beh|ecco|chiaro|"
                 "giusto|esatto|cioè|tipo|insomma|molto",
    lead_fillers="ok|okay|bene|perfetto|ottimo|certo|grazie|sì|ah|ehm|mm|allora|quindi|dunque|beh|ecco|chiaro|"
                 "giusto|esatto|cioè|insomma",
    continuers="e|e poi|e dopo|perché|come|come mai|in che senso|per esempio|ad esempio|tipo cosa|cos altro|altro|"
               "qualcos altro|continua|continui|prosegua|prosegui|vada avanti|vai avanti|e quindi|e perché|e come|"
               "cioè|ovvero|di più|perché no",
    follow_up="perché ha|perché hai|perché non|cosa è successo|cos è successo|e poi|cosa farebbe diversamente|"
              "cosa faresti diversamente|cosa cambierebbe|e il|e la|e i|e le|e il suo|e la sua|e il tuo|e la tua|"
              "e cosa|e come|e perché|più dettagli|di più su|quel progetto|quella decisione|quell approccio|"
              "quel database|il team|il risultato|il progetto|col senno di poi|guardando indietro",
    trailing="e|o|ma|che|di|del|dello|della|dei|degli|delle|il|lo|la|l|i|gli|le|un|uno|una|a|al|allo|alla|ai|in|"
             "nel|nella|con|per|se|perché|come|su|sul|sulla|mio|mia|suo|sua|tuo|tua|nostro|questo|questa|quel|"
             "quella|da|dal|dalla|tra|fra|quando|dove|quale|mi|ti|ci|si",
    clause_breaks="e|allora|quindi|ok|okay|bene|ora|adesso|perfetto|ottimo",
    openers="allora|quindi|dunque|ok|okay|bene|ora|adesso|e|beh|ecco|ehm",
    new_topic="passiamo a|passiamo ora|cambiamo argomento|cambiando argomento|prossima domanda|"
              "la prossima domanda|la mia prossima domanda|un altra domanda|ancora una domanda|ultima domanda|"
              "l ultima domanda|ora passiamo|adesso passiamo|per la prossima parte|nella prossima parte|"
              "per concludere|per finire",
    lead_in="parliamo di|vorrei parlare di|ha menzionato|hai menzionato|vedo che|ho visto che|nel suo curriculum|"
            "nel tuo curriculum|nel suo cv|guardando il suo|nel suo ultimo ruolo|nella sua azienda precedente|"
            "vorrei chiederle di|tornando a|torniamo a|a proposito di|parlando di|questa domanda riguarda|"
            "cominciamo con|iniziamo con|facciamo una|facciamo un",
    check_ins="mi sente|mi senti|mi sentite|si sente|mi vede|mi vedi|vede il mio schermo|vedi il mio schermo|"
              "ha senso|è chiaro|tutto chiaro|è ancora lì|sei ancora lì|le serve un momento|ti serve un momento|"
              "ha bisogno di un momento|le serve più tempo|è pronto|è pronta|sei pronto|sei pronta|"
              "pronti per iniziare|possiamo iniziare|possiamo cominciare|possiamo continuare|andiamo avanti|"
              "va bene così|le va bene|ti va bene|tutto bene|domande finora",
    logistics="condividere lo schermo|condivida lo schermo|condividi lo schermo|condivido lo schermo|"
              "è in muto|sei in muto|ha il microfono spento|accenda la telecamera|accendi la telecamera|"
              "mi dica quando|mi faccia sapere quando",
    asides="si sente a scatti|si blocca|si è bloccato|la mia connessione|il mio internet|ti ho perso|prendo nota|"
           "mi segno|mi annoto|sto prendendo appunti",
    reassurance="si prenda il suo tempo|prenditi il tuo tempo|con calma|nessuna fretta|senza fretta|"
                "nessuna pressione|non si preoccupi|non ti preoccupare|quando è pronto|quando sei pronto|"
                "pensi ad alta voce|pensa ad alta voce|non c è una risposta sbagliata",
    pleasantries="grazie per essere venuto|grazie di essere qui|grazie per il suo tempo|grazie del tempo|"
                 "piacere di conoscerla|piacere di conoscerti|piacere|benvenuto|benvenuta|buongiorno|buonasera|"
                 "ciao",
    reaction="molto bene|bene|perfetto|ottimo|eccellente|grazie|va bene|ok|d accordo|capito|ho capito|"
             "interessante|mi piace|bella risposta|buon punto|chiaro|benissimo|esatto",
    backchannel="sì|ok|okay|certo|ah|ehm|mm|mhm|allora|quindi|beh|ecco|bene|perfetto|esatto|giusto|chiaro|grazie|"
                "cioè|tipo|va bene|capisco|ho capito",
    markers="che|di|il|lo|gli|della|delle|dei|degli|nel|nella|sono|è|per|un|perché|quando|dove|quale|lei|suo|sua|"
            "mi|ci|può|potrebbe|anche|questo|questa|molto|più|ha|hai|ho|sei|cosa|parli|spieghi|progetto|"
            "esperienza|lavoro|azienda|squadra|domanda|mai|come|e|alla|al|una",
    types={
        "salary": "stipendio|retribuzione|ral|aspettative economiche|richiesta economica|preavviso",
        "clarification": "cosa intende|cosa intendi|può chiarire|puoi chiarire|può ripetere|puoi ripetere",
        "coding": "funzione|algoritmo|codice|programma|scriva una|scriva un|implementi|complessità|array|"
                  "lista concatenata|albero binario|stringa|query sql|ricorsione|ricorsivo",
        "system_design": "progettare un sistema|progetterebbe|progetteresti|architettura|scalare|scalabilità|"
                         "distribuito|alta disponibilità|bilanciatore|microservizi|milioni di utenti",
        "resume": "mi parli di lei|parlami di te|si presenti|presentati|la sua esperienza|la tua esperienza|"
                  "il suo percorso|il tuo percorso|il suo curriculum|il tuo curriculum|il suo ultimo progetto|"
                  "il suo ruolo attuale|ha lavorato con|hai lavorato con|ha usato|hai usato|un progetto di cui",
        "behavioral": "una volta in cui|una situazione in cui|un momento in cui|conflitto|disaccordo|fallimento|"
                      "fallito|errore|orgoglioso|orgogliosa|difficile|sfida|pressione|scadenza|feedback|"
                      "punto di forza|punti di forza|punto debole|punti deboli|priorità",
        "leadership": "guidare un team|guidato un team|leadership|mentore|mentor|delegare|stakeholder|influenzare",
        "culture": "perché vuole|perché vuoi|perché questa azienda|perché noi|perché lascia|perché lasci|"
                   "la nostra cultura|valori|dove si vede|dove ti vedi|cosa la motiva|cosa ti motiva|"
                   "perché dovremmo assumerla|perché questo ruolo|domande per",
        "story": "mi parli di una volta|mi racconti di una volta|raccontami di una volta|descriva una situazione|"
                 "mi faccia un esempio di una volta|una volta in cui|una situazione in cui|le è mai capitato",
    },
    size={
        "brief": "in una parola|in una frase|sì o no|domanda veloce",
        "short": "brevemente|in breve|in sintesi|in poche parole|velocemente|a grandi linee",
        "deep": "in dettaglio|nel dettaglio|in profondità|passo dopo passo|dettagliatamente|dall inizio alla fine|"
                "da zero",
        "define": "che cos è|cos è|che cosa sono|cosa significa",
        "experience": "ha usato|hai usato|ha lavorato con|hai lavorato con|esperienza con|esperienza in|conosce|"
                      "conosci",
        "approach": "come farebbe|come faresti|cosa farebbe|cosa faresti|come affronterebbe|come affronteresti|"
                    "come risolverebbe|come gestirebbe|il suo approccio|il tuo approccio",
        "compare": "differenza tra|differenze tra|confronti|confronta|versus|vs|rispetto a",
        "explain": "spieghi|spiega|descriva|come|perché|racconti|parli|esempio",
        "logistics": "quando può iniziare|quando potrebbe iniziare|data di inizio|preavviso",
        "intro": "mi parli di lei|parlami di te|si presenti|il suo percorso|il suo curriculum",
        "project": "un progetto|il suo ultimo progetto|il suo progetto|progetti che",
        "open_floor": "domande per|qualche domanda",
    },
)

NL = RawCues(
    code="nl", script="latin",
    wh="wat|hoe|waarom|wanneer|waar|welke|welk|wie|hoeveel|waarmee|waarvoor|waarop|waarover|waardoor|in welke|"
       "met welke|bij welk|op welke|voor welke|hoe lang|hoe vaak",
    aux="kunt|kun|kan|kon|heeft|hebt|heb|had|bent|ben|is|zou|zoudt|zouden|wilt|wil|weet|ken|kent|gebruikt|werkt|"
        "hebben|zijn|vind|vindt|denk|denkt|doe|doet|gaat|mag|moet|is er|zijn er",
    request="vertel eens|vertel me|vertel ons|vertel iets|vertel over|vertel|leg uit|leg eens uit|leg me uit|"
            "leg ons uit|beschrijf|geef een voorbeeld|geef me|geef ons|laat zien|laat me zien|laat eens zien|schrijf|"
            "implementeer|ontwerp|vergelijk|stel jezelf voor|stel je voor|stelt u zich voor|licht toe|"
            "licht eens toe|neem me mee|neem ons mee|vat samen|definieer|noem|bereken|los op|optimaliseer|schets|"
            "kun je me vertellen|kunt u me vertellen|kun je uitleggen|kunt u uitleggen|zou je kunnen|zou u kunnen",
    indirect="ik zou graag willen weten|ik wil graag weten|ik wil weten|ik zou willen weten|ik ben benieuwd|"
             "ik ben nieuwsgierig|ik vraag me af|mijn vraag is|de vraag is|ik wilde vragen|ik wil je vragen|"
             "ik wil u vragen|ik zou graag horen|ik hoor graag",
    open_floor="vragen voor mij|vragen voor ons|heb je vragen|heeft u vragen|heb je nog vragen|heeft u nog vragen|"
               "nog vragen|iets toe te voegen|iets wat je wilt vragen|iets dat u wilt vragen",
    fillers="oké|ok|okay|goed|heel goed|prima|mooi|top|super|dank je|dank je wel|dank u|dank u wel|bedankt|ja|nee|"
            "hm|aha|duidelijk|precies|interessant|heel interessant|klopt|helder|juist|dat klopt|ik snap het|"
            "ik begrijp het|begrepen|geen probleem|een moment|een momentje|een seconde|momentje|wacht|hallo|"
            "goedemorgen|goedemiddag|natuurlijk|zeker|fijn|leuk|geweldig",
    filler_words="oké|ok|okay|goed|prima|mooi|top|super|ja|hm|aha|nou|dus|zo|eh|uh|ehm|precies|klopt|juist|helder|"
                 "duidelijk|bedankt|zeker|heel",
    lead_fillers="oké|ok|okay|goed|prima|mooi|top|super|ja|nee|hm|aha|nou|dus|zo|eh|uh|ehm|precies|klopt|juist",
    continuers="en|en dan|en daarna|waarom|hoe|hoe bedoel je|hoe bedoelt u|bijvoorbeeld|zoals|zoals wat|"
               "wat nog meer|nog iets|iets anders|ga door|ga verder|gaat u verder|en waarom|en hoe|in welke zin|"
               "dat wil zeggen|meer|waarom niet|en verder",
    follow_up="waarom heb je|waarom heeft u|waarom niet|wat gebeurde er|wat is er gebeurd|en toen|en daarna|"
              "wat zou je anders doen|wat zou u anders doen|wat zou je veranderen|en de|en het|en je|en jouw|en uw|"
              "en wat|en hoe|en waarom|meer details|meer over|dat project|die beslissing|die aanpak|die database|"
              "het team|het resultaat|het project|achteraf gezien|terugkijkend",
    trailing="en|of|maar|dat|omdat|als|de|het|een|van|voor|met|op|in|aan|bij|naar|over|te|om|je|jouw|uw|mijn|ons|"
             "onze|die|deze|dit|welke|dan|door|uit|zonder|tussen",
    clause_breaks="en|dus|oké|ok|okay|goed|nou|nu|prima|mooi|top",
    openers="dus|oké|ok|okay|goed|nou|nu|en|zo|ja|eh",
    new_topic="we gaan naar|laten we naar|laten we overgaan|volgende vraag|de volgende vraag|mijn volgende vraag|"
              "een andere vraag|nog een vraag|laatste vraag|de laatste vraag|ander onderwerp|we gaan verder met|"
              "dan gaan we naar|nu gaan we|voor het volgende deel|in het volgende deel|tot slot|om af te sluiten",
    lead_in="laten we het hebben over|we gaan het hebben over|je noemde|u noemde|je zei|ik zie dat|ik zag dat|"
            "op je cv|op uw cv|in je cv|als ik naar je|in je vorige rol|bij je vorige werkgever|"
            "ik wil je iets vragen over|terug naar|om terug te komen op|over het onderwerp|deze vraag gaat over|"
            "laten we beginnen met|we beginnen met|laten we een|we doen een",
    check_ins="hoor je me|hoort u me|kun je me horen|kunt u me horen|zie je mijn scherm|ziet u mijn scherm|"
              "zie je me|ziet u me|is dat duidelijk|is het duidelijk|snap je|begrijp je|ben je er nog|"
              "bent u er nog|heb je even nodig|heeft u even nodig|heb je meer tijd nodig|ben je klaar|bent u klaar|"
              "ben je er klaar voor|kunnen we beginnen|zullen we beginnen|kunnen we verder|zullen we verder gaan|"
              "gaan we verder|is dat goed|is dat oké|alles goed|tot nu toe vragen",
    logistics="scherm delen|je scherm delen|uw scherm delen|deel je scherm|deelt u uw scherm|ik deel mijn scherm|"
              "je staat op mute|u staat op mute|je staat op stil|camera aan|zet je camera aan|laat het me weten als|"
              "laat maar weten als",
    asides="je valt weg|u valt weg|je hapert|bevroren|slechte verbinding|mijn internet|ik ben je kwijt|"
           "ik maak een aantekening|ik noteer|ik schrijf even mee|even noteren",
    reassurance="neem je tijd|neem rustig de tijd|neemt u de tijd|geen haast|geen druk|geen zorgen|"
                "als je er klaar voor bent|als u er klaar voor bent|denk hardop|je mag hardop denken|"
                "er is geen fout antwoord",
    pleasantries="bedankt voor je komst|bedankt dat je er bent|bedankt dat u er bent|bedankt voor je tijd|"
                 "bedankt voor uw tijd|leuk je te ontmoeten|leuk kennis te maken|aangenaam|welkom|goedemorgen|"
                 "goedemiddag|hallo",
    reaction="heel goed|goed|prima|mooi|top|super|uitstekend|bedankt|dank je|oké|ok|duidelijk|interessant|"
             "dat is interessant|goed antwoord|goed punt|helder|precies|klopt",
    backchannel="ja|oké|ok|okay|precies|klopt|juist|goed|nou|dus|zo|eh|ehm|hm|mhm|aha|zeker|natuurlijk|prima|top|"
                "duidelijk|en|helder|bedankt",
    markers="het|een|en|van|je|jij|u|uw|jouw|wat|hoe|waarom|niet|met|ik|dat|de|die|deze|dit|voor|op|zijn|hebben|"
            "heb|heeft|kunt|kun|ook|maar|nog|wel|eens|vertel|leg|uit|welke|wanneer|waar|wie|bij|naar|over|"
            "ervaring|project|bedrijf|werk|vraag|er|zou|jullie",
    types={
        "salary": "salaris|salarisindicatie|salariswens|vergoeding|opzegtermijn|wat wil je verdienen",
        "clarification": "wat bedoel je|wat bedoelt u|kun je dat herhalen|kunt u dat herhalen|kun je dat toelichten",
        "coding": "functie|algoritme|code|programma|schrijf een|implementeer|complexiteit|array|gelinkte lijst|"
                  "binaire boom|string|sql query|recursie|recursief",
        "system_design": "systeem ontwerpen|een systeem|zou je ontwerpen|architectuur|schalen|schaalbaarheid|"
                         "gedistribueerd|hoge beschikbaarheid|load balancer|microservices|miljoenen gebruikers",
        "resume": "over jezelf|over uzelf|vertel iets over jezelf|stel jezelf voor|"
                  "stelt u zich voor|je ervaring|uw ervaring|je achtergrond|uw achtergrond|je cv|uw cv|"
                  "je laatste project|je huidige rol|uw huidige rol|je opleiding|heb je gewerkt met|"
                  "heeft u gewerkt met|heb je gebruikt",
        "behavioral": "een keer dat|een situatie waarin|een moment waarop|conflict|meningsverschil|mislukking|"
                      "mislukt|fout|trots|moeilijk|uitdaging|druk|deadline|feedback|sterke punt|sterke punten|"
                      "zwakke punt|zwakke punten|prioriteren",
        "leadership": "team leiden|een team geleid|leiderschap|mentor|delegeren|stakeholders|beïnvloeden",
        "culture": "waarom wil je|waarom wilt u|waarom dit bedrijf|waarom wij|waarom vertrek je|waarom vertrekt u|"
                   "onze cultuur|waarden|waar zie je jezelf|waar ziet u zichzelf|wat motiveert je|"
                   "waarom zouden we jou aannemen|waarom deze functie|vragen voor ons",
        "story": "vertel over een keer|vertel eens over een keer|beschrijf een situatie|geef een voorbeeld van|"
                 "een keer dat|een situatie waarin|heb je ooit",
    },
    size={
        "brief": "in één woord|in een woord|in één zin|ja of nee|korte vraag",
        "short": "kort|in het kort|samengevat|in een paar woorden|snel|globaal",
        "deep": "in detail|uitgebreid|gedetailleerd|stap voor stap|van begin tot eind|vanaf nul|diepgaand",
        "define": "wat is|wat zijn|wat betekent",
        "experience": "heb je gewerkt met|heeft u gewerkt met|ervaring met|heb je gebruikt|ken je|kent u",
        "approach": "hoe zou je|hoe zou u|wat zou je doen|wat zou u doen|hoe pak je|hoe zou je dat aanpakken|"
                    "je aanpak|uw aanpak",
        "compare": "verschil tussen|verschillen tussen|vergelijk|versus|vs|ten opzichte van",
        "explain": "leg uit|beschrijf|hoe|waarom|vertel|voorbeeld",
        "logistics": "wanneer kun je beginnen|wanneer kunt u beginnen|startdatum|opzegtermijn",
        "intro": "vertel iets over jezelf|vertel iets over uzelf|stel jezelf voor|je achtergrond|je cv",
        "project": "een project|je laatste project|je project|projecten die",
        "open_floor": "vragen voor|nog vragen",
    },
)

RU = RawCues(
    code="ru", script="cyrillic",
    wh="что|как|почему|зачем|когда|где|куда|откуда|какой|какая|какое|какие|каким|какую|каких|какими|каком|"
       "который|которая|которое|которые|кто|кого|кому|кем|чей|чья|чьё|сколько|чем|чего|чему|в чём|на чём|с чем|о чём|"
       "в каком|на каком|с какими|для чего|за счёт чего|насколько|каким образом",
    aux="можете|могли|можешь|мог|могли бы|есть|был|была|были|приходилось|доводилось|работали|работал|использовали|"
        "использовал|знаете|знаешь|считаете|думаете|думаешь|хотели|хотите|хотел|сталкивались|сможете|умеете|"
        "умеешь|пробовали|можно|нужно|стоит|согласны",
    particle="ли",
    request="расскажите|расскажи|объясните|объясни|опишите|опиши|приведите|приведи|покажите|покажи|напишите|"
            "напиши|реализуйте|реализуй|спроектируйте|спроектируй|представьтесь|представься|поделитесь|поделись|"
            "уточните|уточни|перечислите|перечисли|сравните|сравни|назовите|назови|оцените|оцени|посчитайте|"
            "вычислите|решите|реши|оптимизируйте|разберите|давайте разберём|давайте обсудим|можете рассказать|"
            "можете объяснить|можете описать|не могли бы вы|могли бы вы|можешь рассказать|можешь объяснить|"
            "пройдитесь|прокомментируйте|обоснуйте|дайте пример|набросайте|нарисуйте|сформулируйте|предложите",
    indirect="хотел бы узнать|хотела бы узнать|хотелось бы узнать|хочу узнать|мне интересно|интересно узнать|"
             "интересно было бы|хочу спросить|хотел спросить|хотела спросить|хотел бы спросить|хотела бы спросить|"
             "мой вопрос|вопрос такой|вопрос в том|хотелось бы услышать|хотел бы услышать|хотела бы услышать",
    open_floor="вопросы ко мне|вопросы к нам|есть ли у вас вопросы|у вас есть вопросы|есть вопросы|"
               "у тебя есть вопросы|хотите что то спросить|хотите что нибудь спросить|хотите что то добавить|"
               "что то добавить|что нибудь добавить",
    fillers="хорошо|ладно|понятно|ясно|отлично|супер|спасибо|большое спасибо|да|нет|угу|ага|окей|ок|так|верно|"
            "именно|интересно|очень интересно|здорово|класс|замечательно|прекрасно|понял|поняла|я понял|я поняла|"
            "всё понятно|конечно|разумеется|договорились|минуту|одну минуту|секунду|одну секунду|минуточку|"
            "подождите|погодите|привет|здравствуйте|добрый день|доброе утро|без проблем|хорошо спасибо|"
            "да конечно|ну хорошо|ну ладно|да да",
    filler_words="хорошо|ладно|понятно|ясно|отлично|супер|спасибо|да|угу|ага|окей|ок|так|ну|вот|верно|именно|"
                 "конечно|значит|итак|э|эм|ээ|мм|хм|понял|поняла|класс|очень",
    lead_fillers="хорошо|ладно|понятно|ясно|отлично|супер|спасибо|да|угу|ага|окей|ок|так|ну|вот|верно|итак|"
                 "значит|э|эм|ээ|хм|слушайте|смотрите",
    continuers="и|а дальше|и дальше|и потом|а потом|почему|как|в смысле|например|например что|что ещё|"
               "что нибудь ещё|продолжайте|продолжай|а почему|и почему|а как|и как|то есть|в каком смысле|"
               "подробнее|поподробнее|почему нет|а именно",
    follow_up="почему вы|почему ты|почему не|почему нет|что случилось|что произошло|а потом|и потом|"
              "что бы вы сделали иначе|что бы ты сделал иначе|что бы вы изменили|а что|а как|а почему|и что|и как|"
              "и почему|а ваш|а ваша|а ваше|подробнее|поподробнее|больше деталей|этот проект|это решение|"
              "этот подход|эта база данных|эту базу|команда|результат|проект|оглядываясь назад|в ретроспективе",
    trailing="и|или|но|а|что|чтобы|в|во|на|с|со|по|к|ко|о|об|обо|для|из|от|у|за|при|про|если|потому|как|который|"
             "которая|которое|которые|ваш|ваша|ваше|ваши|мой|моя|наш|наша|этот|эта|не|бы|когда|где",
    clause_breaks="и|итак|так|хорошо|ладно|отлично|теперь|окей|ок|значит",
    openers="итак|так|хорошо|ладно|ну|теперь|сейчас|окей|ок|и|а|вот|значит",
    new_topic="перейдём к|давайте перейдём|следующий вопрос|мой следующий вопрос|другой вопрос|ещё один вопрос|"
              "последний вопрос|мой последний вопрос|сменим тему|давайте сменим тему|теперь перейдём|"
              "в следующей части|для следующей части|в завершение|напоследок",
    lead_in="давайте поговорим о|давайте поговорим про|поговорим о|поговорим про|вы упомянули|вы сказали|"
            "ты упомянул|я вижу|я заметил|я заметила|в вашем резюме|в резюме|глядя на ваш|на вашей последней|"
            "в вашей последней|на прошлой работе|хочу спросить о|хочу спросить про|вернёмся к|возвращаясь к|"
            "кстати о|говоря о|этот вопрос о|этот вопрос про|начнём с|давайте начнём|давайте сделаем",
    check_ins="вы меня слышите|ты меня слышишь|меня слышно|вам меня слышно|вы меня видите|вам видно|"
              "видите мой экран|вы видите мой экран|видно мой экран|это понятно|понятно ли|всё понятно|вы здесь|"
              "вы ещё здесь|вам нужна минута|нужно время|вам нужно время|вы готовы|ты готов|готовы начать|"
              "можем начинать|можем начать|начнём|можем продолжать|можем продолжить|продолжим|идём дальше|"
              "всё в порядке|вас устраивает|пока вопросы есть",
    logistics="поделиться экраном|поделитесь экраном|покажите экран|демонстрацию экрана|включите демонстрацию|"
              "я поделюсь экраном|у вас выключен микрофон|вы на мьюте|у вас микрофон выключен|включите камеру|"
              "включи камеру|дайте знать когда|скажите когда",
    asides="вас не слышно|пропадаете|вы пропадаете|прерывается|зависло|плохая связь|мой интернет|я вас потерял|"
           "я вас потеряла|я запишу|запишу себе|делаю заметки|отмечу себе",
    reassurance="не торопитесь|не спешите|можете подумать|без спешки|без давления|не волнуйтесь|не переживайте|"
                "когда будете готовы|когда будешь готов|рассуждайте вслух|думайте вслух|можно вслух|"
                "правильного ответа нет|нет неправильных ответов",
    pleasantries="спасибо что пришли|спасибо за ваше время|спасибо что нашли время|рад познакомиться|"
                 "рада познакомиться|приятно познакомиться|добро пожаловать|здравствуйте|добрый день|доброе утро|"
                 "добрый вечер|привет",
    reaction="хорошо|отлично|очень хорошо|прекрасно|замечательно|супер|спасибо|понятно|ясно|ладно|окей|интересно|"
             "это интересно|хороший ответ|хороший пункт|мне нравится|класс|здорово|верно",
    backchannel="да|угу|ага|ок|окей|так|ну|вот|хорошо|понятно|ясно|конечно|именно|верно|мм|хм|э|эм|ээ|значит|"
                "итак|спасибо|отлично|и|а",
    types={
        "salary": "зарплат*|оклад|компенсаци*|ожидания по зарплате|зарплатные ожидания|сколько вы хотите получать|"
                  "уведомлени*",
        "clarification": "что вы имеете в виду|что ты имеешь в виду|можете уточнить|можете повторить|повторите",
        "coding": "функци*|алгоритм*|код|программ*|напишите|реализуйте|сложност*|массив*|связн* списк*|"
                  "бинарн* дерев*|строк*|sql запрос|рекурси*",
        "system_design": "спроектир*|проектировани*|архитектур*|масштабир*|распредел*|высокая доступность|"
                         "отказоустойчив*|балансировщик|микросервис*|миллион* пользовател*",
        "resume": "расскажите о себе|расскажите про себя|расскажи о себе|представьтесь|ваш опыт|вашем опыте|"
                  "ваше резюме|вашем резюме|ваш последний проект|ваша текущая роль|вашей текущей|ваше образование|"
                  "работали ли вы с|вы работали с|использовали ли вы",
        "behavioral": "случай когда|случае когда|ситуаци*|конфликт*|разноглас*|неудач*|провал*|ошибк*|горд*|"
                      "сложн*|трудн*|вызов|давлени*|дедлайн*|срок*|обратн* связ*|сильн* сторон*|слаб* сторон*|"
                      "приоритет*",
        "leadership": "руководил*|руковод*|лидерств*|наставни*|менторств*|делегир*|стейкхолдер*|повлиять",
        "culture": "почему вы хотите|почему наша компания|почему именно мы|почему вы уходите|почему уходите|"
                   "наша культура|ценност*|где вы видите себя|что вас мотивирует|почему мы должны вас нанять|"
                   "почему эта позиция|почему эта вакансия|вопросы к нам",
        "story": "расскажите о случае|расскажите о ситуации|расскажите про случай|опишите ситуацию|"
                 "приведите пример когда|случай когда|ситуацию когда|вам когда нибудь",
    },
    size={
        "brief": "одним словом|одним предложением|да или нет|быстрый вопрос",
        "short": "кратко|вкратце|коротко|в двух словах|в общих чертах|если коротко",
        "deep": "подробно|подробнее|детально|в деталях|шаг за шагом|от начала до конца|с нуля|глубоко",
        "define": "что такое|что значит|что означает",
        "experience": "работали ли вы|вы работали с|опыт работы с|есть ли опыт|использовали ли вы|знакомы ли вы|"
                      "знаете ли вы",
        "approach": "как бы вы|что бы вы сделали|как вы бы|как вы подошли бы|как бы вы решили|ваш подход",
        "compare": "разница между|различия между|чем отличается|сравните|versus|vs",
        "explain": "объясните|опишите|как|почему|расскажите|пример",
        "logistics": "когда вы можете приступить|когда сможете выйти|дата выхода|срок уведомления",
        "intro": "расскажите о себе|расскажите про себя|представьтесь|ваш опыт|ваше резюме",
        "project": "проект|ваш последний проект|ваш проект|проекты которые",
        "open_floor": "есть ли у вас вопросы|вопросы к",
    },
)

HI = RawCues(
    code="hi", script="devanagari", sov=True,
    wh="क्या|क्यों|क्यूं|कैसे|कैसा|कैसी|कब|कहां|कौन|कौनसा|कौनसी|कौनसे|कौन सा|कौन सी|कौन से|कितना|कितनी|कितने|किस|"
       "किसे|किसने|किसको|किन|किससे|किसका|किसकी|किसके",
    request="बताइए|बताइये|बताएं|बताओ|बताना|बता दीजिए|बता दीजिये|बता सकते हैं|बता सकती हैं|बताएंगे|बताइएगा|"
            "समझाइए|समझाइये|समझाएं|समझाओ|समझा सकते हैं|समझाएंगे|सुनाइए|शेयर कीजिए|कीजिए|कीजिये|करिए|करिये|"
            "करके दिखाइए|दिखाइए|लिखिए|लिखिये|लिखें|लिख सकते हैं|उदाहरण दीजिए|उदाहरण दें|दीजिए|दीजिये|"
            "परिचय दीजिए|अपना परिचय",
    indirect="जानना चाहूंगा|जानना चाहूंगी|जानना चाहता हूं|जानना चाहती हूं|जानना चाहेंगे|जानना चाहेंगी|"
             "मेरा सवाल है|मेरा सवाल यह है|मेरा प्रश्न है|पूछना चाहता हूं|पूछना चाहती हूं|पूछना चाहूंगा|"
             "पूछना चाहूंगी|सुनना चाहूंगा|सुनना चाहूंगी|समझना चाहूंगा|समझना चाहूंगी|मुझे जानना है",
    open_floor="कोई सवाल|कोई प्रश्न|कुछ पूछना|कुछ जोड़ना|हमसे कुछ पूछना|मुझसे कुछ पूछना",
    fillers="ठीक है|ठीक|अच्छा|अच्छा जी|हां|जी|जी हां|बहुत अच्छा|बढ़िया|धन्यवाद|शुक्रिया|समझ गया|समझ गई|समझ गयी|"
            "सही|बिल्कुल|बिलकुल|ओके|हम्म|अच्छा ठीक है|ठीक है जी|बहुत बढ़िया|शानदार|एक सेकंड|एक मिनट|एक पल|रुकिए|"
            "रुको|एक सेकंड दीजिए|एक मिनट दीजिए|नमस्ते|नमस्कार|सही है|हां जी|जी बिल्कुल|कोई बात नहीं|दिलचस्प|"
            "इंटरेस्टिंग|गुड|ग्रेट|परफेक्ट|नाइस|कूल|ओके ठीक है",
    filler_words="ठीक|है|अच्छा|हां|जी|ओके|हम्म|तो|बहुत|सही|बढ़िया|धन्यवाद|शुक्रिया|बिल्कुल|बिलकुल|अरे|अब|चलिए|चलो|"
                 "गुड|ग्रेट|परफेक्ट|नाइस|कूल|ना",
    lead_fillers="ठीक|है|अच्छा|हां|जी|ओके|हम्म|तो|अब|चलिए|चलो|अरे|देखिए|सुनिए|बढ़िया|सही",
    continuers="और|और फिर|फिर|उसके बाद|क्यों|कैसे|मतलब|जैसे|जैसे कि|उदाहरण के लिए|और क्या|और कुछ|कुछ और|"
               "आगे बताइए|आगे|जारी रखिए|और क्यों|और कैसे|किस तरह|यानी|थोड़ा और|क्यों नहीं",
    follow_up="आपने क्यों|क्यों चुना|क्यों नहीं|क्या हुआ|उसके बाद|और फिर|अलग क्या करते|अलग तरीके से|क्या बदलेंगे|"
              "और आपका|और आपकी|और आपके|और क्या|और कैसे|और क्यों|और ज़्यादा|थोड़ा और|विस्तार से|उस प्रोजेक्ट|"
              "वह फैसला|वो फैसला|वह तरीका|वो तरीका|उस डेटाबेस|टीम|नतीजा|रिजल्ट|पीछे मुड़कर",
    trailing="और|या|लेकिन|पर|परंतु|कि|के|की|का|को|से|में|तो|जो|अगर|क्योंकि|जब|ताकि|आपके|आपकी|आपका|मेरे|मेरी|"
             "मेरा|इस|उस|एक|वाले|वाली|लिए|बारे|साथ|बाद",
    clause_breaks="और|तो|अच्छा|अब|चलिए|ओके",
    openers="तो|अच्छा|ठीक|है|अब|चलिए|चलो|और|ओके|हां|जी|हम्म",
    new_topic="अगला सवाल|अगला प्रश्न|मेरा अगला सवाल|एक और सवाल|आखिरी सवाल|अंतिम सवाल|दूसरे टॉपिक|टॉपिक बदलते|"
              "विषय बदलते|चलिए अब|अब चलते हैं|अब बात करते हैं|आगे बढ़ते हैं|अगले हिस्से|अगले पार्ट|आखिर में",
    lead_in="बात करते हैं|के बारे में बात|आपने बताया|आपने कहा|आपने जिक्र|मैं देख रहा हूं|मैं देख रही हूं|मैंने देखा|"
            "आपके रिज्यूमे|आपके रेज्यूमे|आपके सीवी|आपकी पिछली|आपके पिछले|मैं पूछना चाहता हूं|वापस आते हैं|"
            "इसी बारे में|शुरू करते हैं|से शुरू करते",
    check_ins="आवाज आ रही|आप मुझे सुन पा रहे|सुनाई दे रहा|सुनाई दे रही|स्क्रीन दिख रही|दिख रहा है|समझ आया|"
              "समझ आ गया|क्लियर है|साफ है|आप वहां हैं|आप हैं क्या|एक मिनट चाहिए|थोड़ा समय चाहिए|आप तैयार हैं|"
              "तैयार हैं|शुरू करें|आगे बढ़ें|ठीक है ना|सब ठीक",
    logistics="स्क्रीन शेयर|म्यूट पर|आप म्यूट|कैमरा ऑन|कैमरा चालू|मुझे बताइए जब|बताइएगा जब",
    asides="आवाज कट|कट रही है|अटक गया|नेटवर्क|इंटरनेट|नोट कर लेता|नोट कर लेती|नोट कर रहा|नोट कर रही|"
           "लिख लेता हूं|लिख लेती हूं",
    reassurance="आराम से|अपना समय लीजिए|समय लीजिए|कोई जल्दी नहीं|जल्दी नहीं है|कोई दबाव नहीं|चिंता मत कीजिए|"
                "चिंता न करें|जब आप तैयार हों|जब तैयार हों|ज़ोर से सोचिए|कोई गलत जवाब नहीं",
    pleasantries="आने के लिए धन्यवाद|समय देने के लिए धन्यवाद|जुड़ने के लिए धन्यवाद|आपसे मिलकर अच्छा लगा|"
                 "मिलकर खुशी हुई|स्वागत है|आपका स्वागत|नमस्ते|नमस्कार|शुभ प्रभात",
    reaction="बहुत अच्छा|अच्छा|बढ़िया|बहुत बढ़िया|शानदार|धन्यवाद|शुक्रिया|ठीक है|ओके|सही|समझ गया|समझ गई|दिलचस्प|"
             "अच्छा जवाब|अच्छा पॉइंट|गुड|ग्रेट|परफेक्ट",
    backchannel="हां|जी|जी हां|ठीक|है|अच्छा|ओके|हम्म|तो|बिल्कुल|सही|मतलब|जैसे|वो|वह|यानी|धन्यवाद|शुक्रिया|और|अं|"
                "उम्म",
    types={
        "salary": "सैलरी|वेतन|तनख्वाह|पैकेज|सीटीसी|नोटिस पीरियड|अपेक्षित सैलरी",
        "clarification": "आपका मतलब|मतलब क्या है|फिर से बताइए|दोबारा बताइए|दोहरा सकते",
        "coding": "फंक्शन|एल्गोरिदम|कोड|प्रोग्राम|कोड लिखिए|प्रोग्राम लिखिए|इम्प्लीमेंट|कॉम्प्लेक्सिटी|ऐरे|"
                  "लिंक्ड लिस्ट|बाइनरी ट्री|स्ट्रिंग|क्वेरी",
        "system_design": "सिस्टम डिजाइन|सिस्टम कैसे डिजाइन|आर्किटेक्चर|स्केल|स्केलेबल|डिस्ट्रीब्यूटेड|लोड बैलेंसर|"
                         "माइक्रोसर्विस|लाखों यूजर|करोड़ों यूजर",
        "resume": "अपने बारे में|अपना परिचय|आपका अनुभव|आपके अनुभव|आपका एक्सपीरियंस|रिज्यूमे|रेज्यूमे|"
                  "पिछले प्रोजेक्ट|आखिरी प्रोजेक्ट|आपकी पढ़ाई|आपकी डिग्री|आपकी मौजूदा|आपकी करंट|"
                  "काम किया है|इस्तेमाल किया है",
        "behavioral": "ऐसा समय|एक बार जब|कोई ऐसा समय|ऐसी स्थिति|किसी स्थिति|संघर्ष|असहमति|गलती|विफलता|फेल|गर्व|"
                      "मुश्किल|चुनौती|दबाव|डेडलाइन|फीडबैक|ताकत|स्ट्रेंथ|कमजोरी|वीकनेस|प्राथमिकता|प्रायोरिटी",
        "leadership": "टीम का नेतृत्व|टीम को लीड|नेतृत्व|लीडरशिप|मेंटर|डेलीगेट|स्टेकहोल्डर",
        "culture": "यह नौकरी क्यों|यह रोल क्यों|हमारी कंपनी क्यों|हमारी कंपनी में क्यों|क्यों छोड़|हमारी संस्कृति|"
                   "मूल्य|खुद को कहां देखते|आपको क्या प्रेरित|मोटिवेट|हम आपको क्यों|कोई सवाल",
        "story": "ऐसा समय बताइए|एक बार के बारे में|कोई ऐसा समय|ऐसी स्थिति के बारे में|एक उदाहरण दीजिए जब|"
                 "कभी ऐसा हुआ",
    },
    size={
        "brief": "एक शब्द में|एक लाइन में|हां या ना|हां या नहीं|छोटा सा सवाल",
        "short": "संक्षेप में|शॉर्ट में|थोड़े में|जल्दी से|मोटे तौर पर|कम शब्दों में",
        "deep": "विस्तार से|डिटेल में|गहराई से|स्टेप बाय स्टेप|शुरू से आखिर तक|शुरुआत से",
        "define": "क्या होता है|क्या है|क्या होती है|क्या मतलब है",
        "experience": "काम किया है|इस्तेमाल किया है|यूज किया है|अनुभव है|एक्सपीरियंस है|जानते हैं",
        "approach": "आप कैसे करेंगे|आप क्या करेंगे|कैसे हैंडल करेंगे|कैसे सुलझाएंगे|कैसे अप्रोच|आपका तरीका|"
                    "आपकी अप्रोच",
        "compare": "में अंतर|में फर्क|का अंतर|तुलना|बनाम|versus|vs",
        "explain": "समझाइए|बताइए|कैसे|क्यों|उदाहरण",
        "logistics": "कब से जॉइन|कब जॉइन|जॉइनिंग|नोटिस पीरियड",
        "intro": "अपने बारे में|अपना परिचय",
        "project": "प्रोजेक्ट",
        "open_floor": "कोई सवाल|कुछ पूछना",
    },
)

HINGLISH = RawCues(
    code="hinglish", script="latin", sov=True,
    wh="kya|kyun|kyon|kyu|kaise|kaisa|kaisi|kab|kahan|kahaan|kaun|kaunsa|kaunsi|kaunse|kaun sa|kaun si|kaun se|"
       "kitna|kitni|kitne|kis|kise|kisne|kisko|kisse|kiska|kiski|kiske",
    request="bataiye|bataye|batayein|batayen|batao|bata do|bata dijiye|bata sakte|bata sakti|bataoge|bataenge|"
            "batayenge|bataiyega|samjhaiye|samjhayein|samjhao|samjha sakte|samjha sakti|samjhayenge|sunaiye|"
            "share kijiye|share karo|share kariye|kijiye|kijie|kariye|karo|karein|karen|karke dikhaiye|dikhaiye|"
            "dikhao|likhiye|likho|likhein|likh sakte|example dijiye|example do|dijiye|dijie|introduce kijiye|"
            "introduce karo|apna introduction|explain karo|explain kijiye|explain kariye|describe karo|"
            "describe kijiye",
    indirect="jaanna chahunga|janna chahunga|jaanna chahungi|janna chahungi|jaanna chahta hoon|janna chahta hu|"
             "jaanna chahti hoon|janna chahti hu|jaanna chahenge|mera sawal hai|mera question hai|"
             "mera question ye hai|poochna chahta|puchna chahta|poochna chahti|puchna chahti|poochna chahunga|"
             "puchna chahunga|sunna chahunga|samajhna chahunga|mujhe jaanna hai|mujhe janna hai|curious hoon|"
             "curious hu",
    open_floor="koi sawal|koi question|koi questions|kuch poochna|kuch puchna|kuch add karna|kuch jodna|humse kuch|"
               "mujhse kuch",
    fillers="theek hai|thik hai|thik|theek|accha|acha|achha|accha ji|haan|han|ha|ji|ji haan|ji ha|bahut accha|"
            "bahut acha|badhiya|badiya|dhanyavaad|dhanyawad|shukriya|samajh gaya|samajh gayi|samajh gai|sahi|"
            "bilkul|ok|okay|hmm|accha theek hai|theek hai ji|bahut badhiya|shaandar|ek second|ek sec|ek minute|"
            "ek min|ek pal|ruko|rukiye|ek second dijiye|ek minute dijiye|namaste|namaskar|sahi hai|haan ji|"
            "ji bilkul|koi baat nahi|koi baat nahin|interesting|good|great|perfect|nice|cool|ok theek hai|"
            "acha theek hai",
    filler_words="theek|thik|hai|accha|acha|achha|haan|han|ha|ji|ok|okay|hmm|toh|to|bahut|sahi|badhiya|dhanyavaad|"
                 "shukriya|bilkul|arre|are|ab|chaliye|chalo|good|great|perfect|nice|cool|na|yaar|matlab",
    lead_fillers="theek|thik|hai|accha|acha|achha|haan|han|ji|ok|okay|hmm|toh|to|ab|chaliye|chalo|arre|dekhiye|"
                 "suniye|so|well|um|uh|sahi|badhiya",
    continuers="aur|aur phir|phir|uske baad|kyun|kyon|kaise|matlab|jaise|jaise ki|for example|aur kya|aur kuch|"
               "kuch aur|aage bataiye|aage|continue kijiye|continue karo|aur kyun|aur kaise|kis tarah|yaani|"
               "thoda aur|kyun nahi|kyon nahi",
    follow_up="aapne kyun|kyun choose|kyun chuna|kyun nahi|kya hua|uske baad|aur phir|alag kya karte|"
              "kya change karenge|aur aapka|aur aapki|aur aapke|aur kya|aur kaise|aur kyun|aur zyada|thoda aur|"
              "detail mein|us project|woh project|wo project|woh decision|wo decision|woh approach|wo approach|"
              "us database|project mein|peeche mud kar",
    trailing="aur|ya|lekin|par|ki|ke|ka|ko|se|mein|me|toh|to|jo|agar|kyunki|jab|taaki|aapke|aapki|aapka|mere|meri|"
             "mera|is|us|ek|wale|wali|liye|baare|saath|baad",
    clause_breaks="aur|toh|accha|acha|theek|ab|chaliye|ok|okay",
    openers="toh|to|accha|acha|theek|thik|hai|ab|chaliye|chalo|aur|ok|okay|haan|ji|hmm|so",
    new_topic="agla sawal|agla question|mera agla sawal|ek aur sawal|ek aur question|aakhri sawal|akhri sawal|"
              "dusre topic|topic change|chaliye ab|ab chalte hain|ab baat karte hain|aage badhte hain|agle part|"
              "aakhir mein",
    lead_in="baat karte hain|ke baare mein baat|aapne bataya|aapne kaha|aapne mention kiya|aapne zikr|"
            "main dekh raha hoon|main dekh rahi hoon|maine dekha|aapke resume|aapke cv|aapki pichli|aapke pichle|"
            "aapki last|aapke last|main poochna chahta|wapas aate hain|isi baare mein|shuru karte hain|"
            "se shuru karte",
    check_ins="meri awaaz aa rahi|awaaz aa rahi|awaz aa rahi|aap mujhe sun pa rahe|sunai de raha|sunai de rahi|"
              "meri screen dikh rahi|screen dikh rahi|dikh raha hai|samajh aaya|samajh aa gaya|clear hai|"
              "aap wahan hain|aap hain kya|ek minute chahiye|thoda time chahiye|aap ready hain|ready hain|"
              "shuru karein|shuru karen|aage badhein|theek hai na|thik hai na|sab theek|sab thik",
    logistics="screen share|aap mute|mute par|mute pe|camera on|batana jab|bataiyega jab",
    asides="awaaz cut|awaz cut|cut ho raha|cut ho rahi|atak gaya|network|internet|note kar leta|note kar leti|"
           "note kar raha|note kar rahi|likh leta hoon|likh leti hoon",
    reassurance="aaram se|apna time lijiye|time lijiye|koi jaldi nahi|jaldi nahi hai|koi pressure nahi|"
                "tension mat lijiye|chinta mat kijiye|jab aap ready hon|jab ready ho|zor se sochiye|"
                "koi galat jawab nahi",
    pleasantries="aane ke liye thank you|aane ke liye dhanyavaad|time dene ke liye|join karne ke liye|"
                 "aapse milkar accha laga|milkar khushi hui|swagat hai|aapka swagat|namaste|namaskar",
    reaction="bahut accha|bahut acha|accha|acha|badhiya|bahut badhiya|shaandar|dhanyavaad|shukriya|theek hai|"
             "thik hai|ok|sahi|samajh gaya|samajh gayi|interesting|accha jawab|good answer|good point|great|perfect",
    backchannel="haan|han|ha|ji|ji haan|theek|thik|hai|accha|acha|ok|okay|hmm|toh|to|bilkul|sahi|matlab|jaise|woh|"
                "wo|yaani|dhanyavaad|shukriya|aur|yaar|na",
    markers="kya|hai|hain|aap|aapka|aapki|aapke|aapne|mein|ke|ki|ka|ko|se|kaise|kyun|kyon|kab|kahan|kaun|kitna|"
            "bataiye|batao|apne|baare|nahi|nahin|kar|karte|karti|kiya|tha|thi|yeh|ye|woh|wo|aur|toh|bhi|kuch|hum|"
            "mujhe|humein|apna|apni|sakte|sakti|raha|rahe|rahi|hoon|hu|jaise|matlab|accha|theek|kaam|kijiye",
    types={
        "salary": "salary|ctc|package|notice period|expected salary|kitni salary",
        "clarification": "aapka matlab|matlab kya|phir se bataiye|dobara bataiye|repeat kar",
        "coding": "function|algorithm|code likhiye|code likho|program likhiye|implement|complexity|array|"
                  "linked list|binary tree|string|query",
        "system_design": "system design|system kaise design|architecture|scale|scalable|distributed|"
                         "load balancer|microservice|lakhs users|crore users",
        "resume": "apne baare mein|apna introduction|aapka experience|aapke experience|resume|last project|"
                  "pichle project|current role|aapki padhai|aapki degree|kaam kiya hai|use kiya hai",
        "behavioral": "aisa time|ek time jab|koi aisa time|aisi situation|kisi situation|conflict|disagreement|"
                      "galti|mistake|failure|fail|proud|mushkil|challenge|pressure|deadline|feedback|strength|"
                      "weakness|priority|prioritize",
        "leadership": "team lead|team ko lead|leadership|mentor|delegate|stakeholder",
        "culture": "yeh job kyun|ye job kyun|yeh role kyun|company kyun|kyun join|kyun chhod|culture|values|"
                   "kahan dekhte|motivate|hum aapko kyun|koi sawal|koi question",
        "story": "aisa time bataiye|ek time ke baare mein|koi aisa time|aisi situation ke baare mein|"
                 "example dijiye jab|kabhi aisa hua",
    },
    size={
        "brief": "ek word mein|ek line mein|haan ya na|haan ya nahi|chhota sa sawal",
        "short": "short mein|briefly|jaldi se|thode mein|kam shabdon mein",
        "deep": "detail mein|vistaar se|step by step|shuru se|end to end",
        "define": "kya hota hai|kya hai|kya hoti hai|matlab kya",
        "experience": "kaam kiya hai|use kiya hai|experience hai|jaante hain|jante hain",
        "approach": "aap kaise karenge|aap kya karenge|kaise handle karenge|kaise solve karenge|approach kya hogi|"
                    "aapka approach",
        "compare": "mein difference|mein farak|ka difference|compare|vs|versus",
        "explain": "samjhaiye|bataiye|kaise|kyun|example",
        "logistics": "kab join|joining|notice period",
        "intro": "apne baare mein|apna introduction",
        "project": "project",
        "open_floor": "koi sawal|koi question|kuch poochna",
    },
)

JA = RawCues(
    code="ja", script="japanese", sov=True,
    wh="何|なに|なんで|なんの|なぜ|何故|どう|どうして|どのように|どんな|いつ|どこ|どれ|どの|だれ|誰|いくつ|いくら|"
       "どのくらい|どれくらい|どちら|どっち",
    endings="か|かな|かね|ですかね|でしょうか|ですか|ますか|ませんか|でしたか|ましたか|かしら",
    request="ください|下さい|してください|教えてください|教えて下さい|教えていただけますか|教えていただけませんか|"
            "教えてもらえますか|聞かせてください|聞かせていただけますか|説明してください|説明していただけますか|"
            "説明してもらえますか|話してください|お話しください|お聞かせください|お願いします|お願いできますか|"
            "いただけますか|いただけませんか|もらえますか|もらえませんか|くれますか|書いてください|"
            "実装してください|設計してください|紹介してください|教えて|説明して|話して|聞かせて",
    indirect="知りたい|お聞きしたい|伺いたい|聞きたい|お伺いしたい|お聞きしたいのは|伺いたいのは|興味があります|"
             "気になります|知りたいのは|質問は",
    open_floor="何か質問|ご質問はありますか|質問はありますか|何か聞きたいこと|逆質問|何かございますか|付け加えたいこと",
    fillers="はい|ええ|うん|なるほど|そうですね|そうですか|そうなんですね|そうなんですか|わかりました|分かりました|"
            "了解です|了解しました|かしこまりました|ありがとうございます|ありがとうございました|どうも|いいですね|"
            "素晴らしい|すばらしい|確かに|たしかに|はいはい|オーケー|ok|okay|大丈夫です|結構です|いいですよ|どうぞ|"
            "ちょっと待ってください|少々お待ちください|お待ちください|少しお待ちください|すみません|こんにちは|"
            "よろしくお願いします|よろしくお願いいたします|面白いですね|興味深いですね|そうですよね|ですよね|"
            "えーと|えっと|あの|あのー|まあ|うーん|えー",
    lead_fillers="はい|ええ|えー|えっと|えーと|あの|あのー|では|じゃあ|それでは|それじゃ|さて|まあ|うん|なるほど|"
                 "そうですね|ありがとうございます|わかりました|分かりました|うーん",
    continuers="それで|それから|その後|なぜ|どうして|なんで|例えば|たとえば|他には|ほかには|続けてください|"
               "具体的には|というと|つまり|もう少し|もっと詳しく|詳しく|なぜですか|どうしてですか|具体的に",
    follow_up="なぜそう|どうしてそう|なぜその|何が起き|その後|それから|違うやり方|何を変え|そのプロジェクト|"
              "その決定|そのアプローチ|そのデータベース|チーム|結果|振り返って|具体的に|もう少し詳しく|詳しく教えて",
    trailing_endings="て|で|が|けど|けれど|けれども|けども|し|と|から|ので|を|に|は|も|や|って|とか|ながら|たり|"
                     "ですが|ますが",
    openers="では|じゃあ|それでは|それじゃあ|さて|えっと|えーと|あの|はい|ええ|まあ|うーん",
    new_topic="次の質問|では次|それでは次|話題を変え|別の質問|もう一つ質問|もうひとつ質問|最後の質問|次のパート|"
              "続いて|テーマを変え|次は|次に",
    lead_in="について話しましょう|についてお聞きします|についてお伺いします|についてです|おっしゃっていた|"
            "言っていた|履歴書|職務経歴書|経歴を拝見|拝見しました|前職では|前の会社|に戻りますが|話を戻し|ところで|"
            "まず|まずは",
    check_ins="聞こえますか|聞こえていますか|聞こえてますか|見えますか|見えていますか|画面見えますか|画面は見えますか|"
              "大丈夫ですか|よろしいですか|いいですか|わかりますか|分かりますか|伝わりましたか|いらっしゃいますか|"
              "準備はいいですか|準備はよろしいですか|準備できましたか|始めてもいいですか|始めましょうか|"
              "進めてもいいですか|進めましょうか|次に進んでも|ここまでで質問",
    logistics="画面共有|画面を共有|共有します|ミュート|カメラをオン|カメラをつけ|マイクがオフ|準備ができたら教えて|"
              "できたら教えて",
    asides="途切れ|固まって|回線|ネット|電波|メモします|メモを取|メモしておき|書き留め",
    reassurance="ゆっくりで|ゆっくりどうぞ|時間をかけて|急がなくて|焦らなくて|大丈夫ですよ|考えながらで|"
                "声に出して考え|準備ができたら|正解はありません|間違いはありません",
    pleasantries="本日はありがとう|今日はありがとう|お越しいただき|お時間いただき|お時間をいただき|お会いできて|"
                 "はじめまして|初めまして|ようこそ|よろしくお願いします|よろしくお願いいたします|こんにちは|"
                 "おはようございます|お疲れ様です|お疲れさまです",
    reaction="ありがとうございます|なるほど|いいですね|素晴らしい|すばらしい|わかりました|了解です|確かに|面白い|"
             "興味深い|いい答え|いい回答|良い回答|よくわかりました|いいポイント|そうですね",
    backchannel="はい|ええ|うん|えっと|えーと|あの|あのー|まあ|なるほど|そうですね|そうですか|わかりました|"
                "分かりました|はいはい|ありがとうございます|すみません|うーん|えー",
    types={
        "salary": "給与|給料|年収|希望年収|報酬|待遇|退職時期|入社時期",
        "clarification": "どういう意味|どういうことですか|もう一度|繰り返して|言い換え",
        "coding": "関数|アルゴリズム|コード|プログラム|実装|計算量|配列|連結リスト|二分木|文字列|クエリ|再帰",
        "system_design": "システム設計|設計してください|どう設計|アーキテクチャ|スケール|拡張性|スケーラビリティ|分散|"
                         "可用性|ロードバランサ|マイクロサービス|百万ユーザー",
        "resume": "自己紹介|あなた自身について|ご自身について|経歴|ご経験|これまでの経験|職務経歴|前職|前の会社|現職|"
                  "最近のプロジェクト|学歴|専攻|使ったことはありますか|使ったことがありますか|経験はありますか",
        "behavioral": "経験について|状況|時のこと|ときのこと|対立|意見の相違|意見が合わ|失敗|ミス|誇り|"
                      "難しかった|困難|苦労|課題|プレッシャー|締め切り|フィードバック|強み|弱み|長所|短所|優先順位",
        "leadership": "リーダーシップ|チームを率い|マネジメント|部下|メンター|関係者|巻き込",
        "culture": "志望動機|なぜ当社|なぜ弊社|転職理由|退職理由|社風|価値観|将来像|5年後|モチベーション|"
                   "何か質問|ご質問はありますか|逆質問",
        "story": "経験について教えて|時のことを教えて|ときのことを教えて|エピソード|具体例を|状況を教えて|"
                 "ことはありますか",
    },
    size={
        "brief": "一言で|はいかいいえ|簡単な質問",
        "short": "簡単に|簡潔に|手短に|ざっくり|要約|概要",
        "deep": "詳しく|詳細に|ステップバイステップ|順を追って|一から|徹底的|深く",
        "define": "とは|って何|の意味",
        "experience": "使ったことはありますか|使ったことがありますか|経験はありますか|触ったことは|ご存知ですか|"
                      "知っていますか",
        "approach": "どのように|どうやって|どう対応|どうしますか|どう進め|アプローチ",
        "compare": "違い|比較|比べ",
        "explain": "説明|教えて|どのように|なぜ|どうして",
        "logistics": "入社可能|いつから|退職予定|入社日",
        "intro": "自己紹介|あなた自身について|ご自身について|経歴",
        "project": "プロジェクト",
        "open_floor": "何か質問|ご質問|逆質問",
    },
)

ALL: dict[str, RawCues] = {c.code: c for c in (ES, PT, FR, DE, IT, NL, RU, HI, HINGLISH, JA)}
