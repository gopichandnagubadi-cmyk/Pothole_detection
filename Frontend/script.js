/* SMARTCITY FINAL CLIENT
   Plain HTML/CSS/JS + Supabase.
   Replace only the publishable key.
*/

const SUPABASE_URL =
  "SUPABASE_URL";

const SUPABASE_PUBLISHABLE_KEY =
  "SUPABASE_PUBLISHABLE_KEY";

const DETECTION_API_URL = (() => {
  const configured =
    typeof window !== "undefined" &&
    window.DETECTION_API_URL &&
    String(window.DETECTION_API_URL).trim();

  if (configured && !configured.includes("YOUR-API-DOMAIN") && !configured.includes("YOUR-RENDER-SERVICE")) {
    return configured;
  }

  if (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  ) {
    return "http://127.0.0.1:8000/detect";
  }

  return "https://pot-hole-detection-api.onrender.com/detect";
})();

const supabaseClient =
  supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
  );


let currentUser = null;
let currentProfile = null;
let currentRole = null;

let videoStream = null;
let reportMap = null;
let officerMap = null;

let report = {
  image: null,
  file: null,
  lat: null,
  lng: null,
  accuracy: null,
  locality: null,
  city: null,
  state: null,
  notes: "",
  defectType: "Pothole",
  detection: null,
  complaintId: null
};

let detectionRequestId = 0;
let contractorCapture = {
  workOrder: null,
  stream: null
};

let officerComplaints = [];
let workOrders = [];
let contractors = [];

let cache = new Map();


function getWorkOrderId(workOrder) {

  return workOrder.id || workOrder.work_order_id;

}


const $ = id =>
  document.getElementById(id);


const esc = s =>
  String(s ?? "").replace(
    /[&<>"']/g,
    m => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[m])
  );


function toast(msg) {

  const t = $("toast");

  t.textContent = msg;

  t.classList.add("show");

  setTimeout(
    () => t.classList.remove("show"),
    3200
  );
}


function roleName(role) {

  if (role === "officer")
    return "Municipal Officer";

  if (role === "contractor")
    return "Contractor";

  return "Citizen";
}


/* =========================================================
   AUTH
========================================================= */

function setAuthMode(mode) {

  const signup = mode === "signup";

  $("tab-login")
    .classList
    .toggle("active", !signup);

  $("tab-signup")
    .classList
    .toggle("active", signup);

  $("signup-fields")
    .classList
    .toggle("hidden", !signup);

  $("auth-title").textContent =
    signup
      ? "Create your account"
      : "Welcome back";

  $("auth-subtitle").textContent =
    signup
      ? "Choose the workspace you need for this prototype."
      : "Sign in to your infrastructure workspace.";

  $("auth-submit").textContent =
    signup
      ? "Create account"
      : "Login";

  $("forgot-btn")
    .classList
    .toggle("hidden", signup);

  $("auth-message").textContent = "";
}


async function submitAuth() {

  const email =
    $("auth-email").value.trim();

  const password =
    $("auth-password").value;

  $("auth-message").textContent = "";

  if (!email || !password) {

    $("auth-message").textContent =
      "Email and password are required.";

    return;
  }


  const signup =
    !$("signup-fields")
      .classList
      .contains("hidden");


  if (signup) {

    const name =
      $("signup-name").value.trim();

    const role =
      $("signup-role").value;


    if (!name) {

      $("auth-message").textContent =
        "Full name is required.";

      return;
    }


    localStorage.setItem(
      "pending_role",
      role
    );


    const {
      data,
      error
    } =
      await supabaseClient.auth.signUp({

        email,
        password,

        options: {

          data: {
            full_name: name,
            requested_role: role
          }

        }

      });


    if (error) {

      $("auth-message").textContent =
        error.message;

      return;
    }


    if (data.session) {

      await finishLogin(data.user);

    } else {

      $("auth-message").textContent =
        "Account created. Confirm the email if email confirmation is enabled, then log in.";

    }

  } else {

    const {
      data,
      error
    } =
      await supabaseClient.auth.signInWithPassword({

        email,
        password

      });


    if (error) {

      $("auth-message").textContent =
        error.message;

      return;
    }


    await finishLogin(data.user);

  }

}


async function signInWithGoogle() {

  const role =
    $("signup-role")?.value ||
    "citizen";

  localStorage.setItem(
    "pending_role",
    role
  );


  const {
    error
  } =
    await supabaseClient.auth.signInWithOAuth({

      provider: "google",

      options: {

        redirectTo:
          location.origin +
          location.pathname,

        queryParams: {

          access_type: "offline",

          prompt: "select_account"

        }

      }

    });


  if (error)
    $("auth-message").textContent =
      error.message;
}


async function resetPassword() {

  const email =
    $("auth-email").value.trim();


  if (!email) {

    $("auth-message").textContent =
      "Enter your email first.";

    return;
  }


  const {
    error
  } =
    await supabaseClient.auth.resetPasswordForEmail(

      email,

      {
        redirectTo:
          location.origin +
          location.pathname
      }

    );


  $("auth-message").textContent =
    error
      ? error.message
      : "Password reset email sent.";
}


async function finishLogin(user) {

  currentUser = user;


  let {
    data: profile,
    error
  } =
    await supabaseClient
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();


  if (error) {

    toast(error.message);

    return;
  }


  const pending =
    localStorage.getItem("pending_role");


  if (!profile) {

    const role =
      pending ||
      user.user_metadata?.requested_role ||
      "citizen";


    const {
      data: p,
      error: e
    } =
      await supabaseClient
        .from("profiles")
        .insert({

          id: user.id,

          full_name:
            user.user_metadata?.full_name ||
            user.email,

          role

        })
        .select()
        .single();


    if (e) {

      toast(
        "Profile creation failed: " +
        e.message
      );

      return;
    }


    profile = p;

  } else if (
    pending &&
    profile.role === "citizen" &&
    pending !== "citizen"
  ) {

    const {
      data: p,
      error: e
    } =
      await supabaseClient
        .from("profiles")
        .update({
          role: pending
        })
        .eq("id", user.id)
        .select()
        .single();


    if (!e)
      profile = p;

  }


  localStorage.removeItem(
    "pending_role"
  );


  currentProfile = profile;

  currentRole =
    profile.role;


  $("nav-role-badge").textContent =
    roleName(currentRole);


  renderNavLinks();


  if (currentRole === "officer") {

    showView(
      "view-officer-dash"
    );

  } else if (
    currentRole === "contractor"
  ) {

    showView(
      "view-contractor-dash"
    );

  } else {

    showView(
      "view-citizen-dash"
    );

  }

}


function renderNavLinks() {

  const n =
    $("nav-links");

  if (!n)
    return;


  if (currentRole === "citizen") {

    n.innerHTML = `
      <a onclick="showView('view-citizen-dash')">
        Dashboard
      </a>

      <a onclick="startNewReport()">
        Report Problem
      </a>
    `;

  } else if (
    currentRole === "officer"
  ) {

    n.innerHTML = `
      <a onclick="showView('view-officer-dash')">
        Command Center
      </a>
    `;

  } else {

    n.innerHTML = `
      <a onclick="showView('view-contractor-dash')">
        Work Center
      </a>
    `;

  }

}


/* =========================================================
   VIEW CONTROL
========================================================= */

function showView(id) {

  const access = {

    "view-citizen-dash":
      "citizen",

    "view-report-wizard":
      "citizen",

    "view-processing":
      "citizen",

    "view-results":
      "citizen",

    "view-officer-dash":
      "officer",

    "view-contractor-dash":
      "contractor"

  };


  if (
    currentRole &&
    access[id] &&
    access[id] !== currentRole
  ) {

    toast(
      "This dashboard is restricted to " +
      roleName(access[id])
    );

    return;
  }


  document
    .querySelectorAll(".view")
    .forEach(
      v =>
        v.classList.add("hidden")
    );


  $(id)?.classList.remove(
    "hidden"
  );


  $("app-nav")
    .classList
    .toggle(
      "hidden",
      id === "view-login"
    );


  if (
    id ===
    "view-citizen-dash"
  )
    loadCitizen();


  if (
    id ===
    "view-officer-dash"
  )
    loadOfficer();


  if (
    id ===
    "view-contractor-dash"
  )
    loadContractor();

}


async function logout() {

  await supabaseClient.auth.signOut();

  currentUser = null;
  currentProfile = null;
  currentRole = null;

  showView(
    "view-login"
  );

  setAuthMode("login");
}


/* =========================================================
   CITIZEN REPORT
========================================================= */

function resetReport() {

  stopCamera();
  detectionRequestId++;


  report = {

    image: null,
    file: null,

    lat: null,
    lng: null,
    accuracy: null,

    locality: null,
    city: null,
    state: null,

    notes: "",
    defectType: "Pothole",
    detection: null,

    complaintId: null

  };


  $("photo-preview").src = "";

  $("photo-preview")
    .classList
    .add("hidden");


  $("camera-placeholder")
    .classList
    .remove("hidden");


  $("report-file").value = "";

  $("detection-alert").className = "detection-alert hidden";
  $("detection-alert").textContent = "";

  $("report-notes").value = "";

  $("submit-report").disabled =
    true;


  $("location-address")
    .classList
    .add("hidden");


  $("report-map")
    .classList
    .add("hidden");


  $("location-display").innerHTML = `
    <b>📍 Location not captured</b>
    <span>
      GPS or manual coordinates are required.
    </span>
  `;

}


function startNewReport() {

  resetReport();

  showView(
    "view-report-wizard"
  );

}


async function startCamera() {

  try {

    videoStream =
      await navigator.mediaDevices
        .getUserMedia({

          video: {
            facingMode: {
              ideal: "environment"
            }
          },

          audio: false

        });


    $("camera-stream")
      .srcObject =
      videoStream;


    $("camera-stream")
      .classList
      .remove("hidden");


    $("camera-placeholder")
      .classList
      .add("hidden");


    $("open-camera")
      .classList
      .add("hidden");


    $("capture-camera")
      .classList
      .remove("hidden");


    $("close-camera")
      .classList
      .remove("hidden");

  } catch (e) {

    toast(
      "Camera unavailable or permission denied. You can upload an image."
    );

  }

}


function stopCamera() {

  if (videoStream) {

    videoStream
      .getTracks()
      .forEach(
        t => t.stop()
      );

    videoStream = null;
  }


  if ($("camera-stream"))
    $("camera-stream").srcObject =
      null;

}


function closeCamera() {

  stopCamera();


  $("camera-stream")
    .classList
    .add("hidden");


  $("camera-placeholder")
    .classList
    .remove("hidden");


  $("open-camera")
    .classList
    .remove("hidden");


  $("capture-camera")
    .classList
    .add("hidden");


  $("close-camera")
    .classList
    .add("hidden");

}


function capturePhoto() {

  const v =
    $("camera-stream");

  const c =
    document.createElement(
      "canvas"
    );


  if (!v.videoWidth) {

    toast(
      "Camera is not ready."
    );

    return;
  }


  c.width =
    v.videoWidth;

  c.height =
    v.videoHeight;


  c.getContext("2d")
    .drawImage(
      v,
      0,
      0
    );


  report.image =
    c.toDataURL(
      "image/jpeg",
      .9
    );


  report.file = null;


  $("photo-preview").src =
    report.image;


  $("photo-preview")
    .classList
    .remove("hidden");


  closeCamera();

  validateReport();
  analyzeReportImage();

}


function handleReportFile(e) {

  const f =
    e.target.files[0];


  if (
    !f ||
    !f.type.startsWith("image/")
  )
    return;


  report.file = f;


  const r =
    new FileReader();


  r.onload =
    ev => {

      report.image =
        ev.target.result;


      $("photo-preview").src =
        report.image;


      $("photo-preview")
        .classList
        .remove("hidden");


      $("camera-placeholder")
        .classList
        .add("hidden");


      validateReport();
      analyzeReportImage();

    };


  r.readAsDataURL(f);

}


function toggleManualLocation() {

  $("manual-location")
    .classList
    .toggle("hidden");

}


function validateCoords(
  lat,
  lng
) {

  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );

}


async function useManualLocation() {

  const lat =
    Number(
      $("manual-lat").value
    );

  const lng =
    Number(
      $("manual-lng").value
    );


  if (
    !validateCoords(
      lat,
      lng
    )
  ) {

    toast(
      "Enter valid latitude and longitude."
    );

    return;
  }


  await setLocation(
    lat,
    lng,
    null,
    "Manual coordinates"
  );

}


function captureGPS() {

  if (
    !navigator.geolocation
  ) {

    toast(
      "Geolocation is not supported."
    );

    return;
  }


  $("location-display")
    .innerHTML = `
      <b>🛰️ Acquiring location…</b>
      <span>
        Please allow location access.
      </span>
    `;


  navigator.geolocation
    .getCurrentPosition(

      p =>

        setLocation(
          p.coords.latitude,
          p.coords.longitude,
          p.coords.accuracy,
          "Live GPS"
        ),

      e =>
        toast(
          "GPS failed: " +
          e.message
        ),

      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      }

    );

}


async function setLocation(
  lat,
  lng,
  accuracy,
  source
) {

  report.lat =
    lat;

  report.lng =
    lng;

  report.accuracy =
    accuracy;


  report.locality =
    null;

  report.city =
    null;

  report.state =
    null;


  renderLocation(
    source
  );


  showReportMap(
    lat,
    lng
  );


  try {

    const place =
      await reverseGeocode(
        lat,
        lng
      );


    Object.assign(
      report,
      place
    );


    renderLocation(
      source
    );

  } catch (e) {

    toast(
      "Coordinates captured, but address lookup failed."
    );

  }


  validateReport();

}


async function reverseGeocode(
  lat,
  lng
) {

  const key =
    `${lat.toFixed(5)},${lng.toFixed(5)}`;


  if (
    cache.has(key)
  )
    return cache.get(key);


  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`;


  const res =
    await fetch(
      url,
      {
        headers: {
          Accept:
            "application/json"
        }
      }
    );


  if (!res.ok)
    throw Error(
      "reverse geocode failed"
    );


  const a =
    (
      await res.json()
    ).address || {};


  const p = {

    locality:
      a.suburb ||
      a.neighbourhood ||
      a.quarter ||
      a.city_district ||
      a.district ||
      a.village ||
      a.hamlet ||
      a.town ||
      a.city ||
      "Unavailable",

    city:
      a.city ||
      a.town ||
      a.village ||
      a.municipality ||
      a.county ||
      a.state_district ||
      "Unavailable",

    state:
      a.state ||
      a.state_district ||
      "Unavailable"

  };


  cache.set(
    key,
    p
  );


  return p;

}


function renderLocation(
  source
) {

  $("location-display")
    .innerHTML = `

      <b>
        ✓ ${esc(source || "Location")} captured
      </b>

      <span>
        Latitude:
        ${report.lat.toFixed(6)}
        •
        Longitude:
        ${report.lng.toFixed(6)}
      </span>

      <span>
        Accuracy:
        ${
          report.accuracy
            ? `±${Math.round(report.accuracy)} m`
            : "manual"
        }
      </span>

    `;


  $("location-address")
    .classList
    .remove("hidden");


  $("loc-locality").textContent =
    report.locality ||
    "Looking up…";


  $("loc-city").textContent =
    report.city ||
    "Looking up…";


  $("loc-state").textContent =
    report.state ||
    "Looking up…";

}


function showReportMap(
  lat,
  lng
) {

  $("report-map")
    .classList
    .remove("hidden");


  if (reportMap)
    reportMap.remove();


  reportMap =
    L.map(
      "report-map"
    ).setView(
      [lat, lng],
      16
    );


  L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      attribution:
        "© OpenStreetMap"
    }
  ).addTo(
    reportMap
  );


  L.marker(
    [lat, lng]
  )
    .addTo(reportMap)
    .bindPopup(
      "Reported defect"
    )
    .openPopup();

}


function validateReport() {

  $("submit-report").disabled =
    !(
      report.image &&
      report.detection?.is_pothole === true &&
      validateCoords(
        report.lat,
        report.lng
      )
    );

}


function detectionAreaRatio(detection) {

  const imageArea =
    Number(detection?.image_width) *
    Number(detection?.image_height);

  if (!Number.isFinite(imageArea) || imageArea <= 0)
    return null;

  const detectedArea = (detection.detections || []).reduce(
    (total, item) => {
      const box = item.box_pixels || {};
      return total + Math.max(
        0,
        (Number(box.xmax) - Number(box.xmin)) *
        (Number(box.ymax) - Number(box.ymin))
      );
    },
    0
  );

  return detectedArea / imageArea;

}


function highestDetectionConfidence(detection) {

  return (detection?.detections || []).reduce(
    (highest, item) => Math.max(highest, Number(item.confidence) || 0),
    0
  );

}


function showDetectionAlert(message, kind = "error") {

  const alert = $("detection-alert");

  if (!alert)
    return;

  alert.textContent = message;
  alert.className = `detection-alert ${kind}`;

}


async function analyzeReportImage() {

  if (!report.image)
    return;

  const requestId = ++detectionRequestId;
  report.detection = null;
  validateReport();
  showDetectionAlert("Checking image for a pothole...", "pending");

  try {
    const detection = await detectReportImage();

    if (requestId !== detectionRequestId)
      return;

    report.detection = detection;

    if (detection.is_pothole === true) {
      showDetectionAlert("Pothole detected. You can continue with this report.", "success");
    } else {
      showDetectionAlert(
        detection.message || "This image does not contain a pothole. Please upload another image.",
        "error"
      );
    }

    validateReport();
  } catch (error) {
    if (requestId !== detectionRequestId)
      return;

    const apiMessage =
      `The pothole detector is unavailable at ${DETECTION_API_URL}. Start the local detection API or update the deployed API URL and try another image.`;

    report.detection = {
      available: false,
      is_pothole: false,
      message: apiMessage
    };
    showDetectionAlert(report.detection.message, "error");
    validateReport();
    console.warn("Detection API call failed:", error, "URL:", DETECTION_API_URL);
  }

}


async function detectReportImage() {

  if (!report.image)
    return null;

  const response = await fetch(
    DETECTION_API_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ image: report.image })
    }
  );

  if (!response.ok)
    throw new Error(`Detection service returned ${response.status}.`);

  return response.json();
}


/* =========================================================
   STORAGE
========================================================= */

async function uploadImage(
  bucket,
  path,
  fileOrData
) {

  let f =
    fileOrData;


  if (
    !f &&
    report.image
  ) {

    const r =
      await fetch(
        report.image
      );

    f =
      await r.blob();

  }


  const {
    error
  } =
    await supabaseClient
      .storage
      .from(bucket)
      .upload(
        path,
        f,
        {
          upsert: true,
          contentType:
            f.type ||
            "image/jpeg"
        }
      );


  if (error)
    throw error;


  return path;

}


async function signedUrl(
  bucket,
  path
) {

  if (!path)
    return null;


  const {
    data,
    error
  } =
    await supabaseClient
      .storage
      .from(bucket)
      .createSignedUrl(
        path,
        3600
      );


  return error
    ? null
    : data.signedUrl;

}


/* =========================================================
   COMPLAINT SUBMISSION
========================================================= */

async function submitComplaint() {

  if (!currentUser) {

    toast(
      "Please log in."
    );

    return;
  }


  if (
    !report.image ||
    report.detection?.is_pothole !== true ||
    !validateCoords(
      report.lat,
      report.lng
    )
  ) {

    toast(
      report.detection?.message ||
      "A pothole image and location are required."
    );

    return;
  }


  report.notes =
    $("report-notes")
      .value
      .trim();


  report.defectType =
    $("defect-type")
      .value;


  showView(
    "view-processing"
  );


  document
    .querySelectorAll(
      "#analysis-steps li"
    )
    .forEach(
      x =>
        x.dataset.done = ""
    );


  for (
    const li of
    document.querySelectorAll(
      "#analysis-steps li"
    )
  ) {

    await new Promise(
      r =>
        setTimeout(
          r,
          400
        )
    );


    li.style.color =
      "var(--green)";


    li.textContent =
      "✓ " +
      li.textContent
        .replace(
          /^✓ /,
          ""
        );

  }


  try {

    const complaintId =
      "CR-" +
      Date.now()
        .toString()
        .slice(-8);


    const path =
      `complaints/${currentUser.id}/${complaintId}.jpg`;


    await uploadImage(
      "road-evidence",
      path,
      report.file
    );


    const {
      data,
      error
    } =
      await supabaseClient
        .from("complaints")
        .insert({

          complaint_id:
            complaintId,

          user_id:
            currentUser.id,

          image_url:
            path,

          latitude:
            report.lat,

          longitude:
            report.lng,

          accuracy:
            report.accuracy,

          locality:
            report.locality,

          city:
            report.city,

          state:
            report.state,

          notes:
            report.notes,

          defect_type:
            report.defectType,

          status:
            "Reported"

        })
        .select()
        .single();


    if (error)
      throw error;


    report.complaintId =
      data.complaint_id;


    const {
      data: analysis,
      error: ae
    } =
      await supabaseClient.rpc(
        "analyze_complaint",
        {
          target_complaint_id: data.complaint_id,
          target_defect_type: report.defectType,
          target_detection_area_ratio: detectionAreaRatio(report.detection),
          target_detection_confidence: highestDetectionConfidence(report.detection)
        }
      );


    if (ae)
      throw ae;


    renderAnalysis(
      data,
      analysis,
      report.detection
    );


    showView(
      "view-results"
    );

  } catch (e) {

    console.error(e);

    toast(
      "Submission failed: " +
      e.message
    );

    showView(
      "view-report-wizard"
    );

  }

}


async function renderAnalysis(
  c,
  a,
  detection
) {

  const url =
    await signedUrl(
      "road-evidence",
      c.image_url
    );


  $("result-img").src =
    url ||
    c.image_url;


  $("result-type").textContent =
    detection?.detections?.length
      ? "Pothole detected"
      : a.defect_type ||
    c.defect_type;

  $("result-confidence").textContent =
    detection?.detections?.length
      ? `${(detection.detections[0].confidence * 100).toFixed(1)}%`
      : detection?.available === false
        ? "Unavailable"
        : "No pothole found";


  $("result-severity").textContent =
    a.severity;


  $("result-size").textContent =
    `${Number(
      a.estimated_size_m2
    ).toFixed(2)} m²`;


  $("result-depth").textContent =
    `${Number(
      a.approximate_depth_cm
    ).toFixed(1)} cm`;

  if ($("result-severity-range"))
    $("result-severity-range").textContent =
      a.severity_ranges || "Severity calculated from defect type, size, and depth.";


  $("result-drainage").textContent =
    a.drainage_nearby
      ? `YES — ${Math.round(
          a.nearest_drainage_distance_m
        )} m`
      : "No nearby record";


  $("result-water").textContent =
    a.water_risk;


  $("result-duplicate").textContent =
    a.duplicate_found
      ? "Possible nearby duplicate"
      : "No nearby duplicate";


  $("result-priority").textContent =
    `${a.priority}/100`;


  $("risk-fill").style.width =
    `${Math.min(
      100,
      Math.max(
        0,
        a.priority
      )
    )}%`;


  $("risk-label").textContent =
    `Maintenance priority: ${
      a.priority >= 81
        ? "VERY SERIOUS"
        : a.priority >= 51
          ? "MEDIUM"
          : "NORMAL"
    }`;


  $("result-title").textContent =
    `${a.severity} priority — ${
      a.defect_type ||
      c.defect_type
    }`;


  $("result-location").innerHTML = `

    <h3>
      📍 Report location
    </h3>

    <div class="data-list">

      <div>
        <span>Locality</span>
        <b>${esc(c.locality)}</b>
      </div>

      <div>
        <span>City</span>
        <b>${esc(c.city)}</b>
      </div>

      <div>
        <span>State</span>
        <b>${esc(c.state)}</b>
      </div>

      <div>
        <span>Coordinates</span>
        <b>
          ${c.latitude.toFixed(6)},
          ${c.longitude.toFixed(6)}
        </b>
      </div>

    </div>

  `;

}


/* =========================================================
   CITIZEN DASHBOARD
========================================================= */

async function loadCitizen() {

  if (!currentUser)
    return;


  const {
    data,
    error
  } =
    await supabaseClient
      .from("complaints")
      .select("*")
      .eq(
        "user_id",
        currentUser.id
      )
      .order(
        "created_at",
        {
          ascending: false
        }
      );


  if (error) {

    toast(
      error.message
    );

    return;
  }


  const rows =
    data || [];


  $("citizen-active")
    .textContent =
    rows.filter(
      x =>
        x.status !==
        "Closed"
    ).length;


  $("citizen-resolved")
    .textContent =
    rows.filter(
      x =>
        x.status ===
        "Closed"
    ).length;


  $("citizen-high")
    .textContent =
    rows.filter(
      x =>
        [
          "Medium",
          "Very Serious"
        ].includes(
          x.severity
        )
    ).length;


  $("citizen-history")
    .innerHTML =

    rows.length

      ? rows.map(
          c => `

            <div class="item-card">

              <div class="item-head">

                <div>

                  <b>
                    ${esc(
                      c.complaint_id
                    )}
                  </b>

                  <h3>
                    ${esc(
                      c.defect_type ||
                      "Defect"
                    )}
                  </h3>

                </div>

                ${severityBadge(
                  c.severity
                )}

              </div>

              <p>
                📍
                ${esc(c.locality)},
                ${esc(c.city)},
                ${esc(c.state)}
              </p>

              <p class="muted">

                ${c.latitude.toFixed(6)},
                ${c.longitude.toFixed(6)}

                • Priority
                ${c.priority ?? "—"}/100

              </p>

              <span class="badge success">
                ${esc(c.status)}
              </span>

            </div>

          `
        ).join("")

      : `
        <div class="item-card">
          No complaints yet.
        </div>
      `;

}


function severityBadge(s) {

  const cl =
    s === "Very Serious"
      ? "serious"
      : s === "Medium"
        ? "medium"
        : "normal";


  return `
    <span class="badge ${cl}">
      ${esc(
        s || "Pending"
      )}
    </span>
  `;

}


/* =========================================================
   OFFICER DASHBOARD
========================================================= */

async function loadOfficer() {

  if (
    currentRole !==
    "officer"
  )
    return;


  const {
    data,
    error
  } =
    await supabaseClient
      .from("complaints")
      .select("*")
      .order(
        "priority",
        {
          ascending: false,
          nullsFirst: false
        }
      );


  if (error) {

    toast(
      error.message
    );

    return;
  }


  officerComplaints =
    data || [];


  const {
    data: cs
  } =
    await supabaseClient
      .from("profiles")
      .select(
        "id,full_name"
      )
      .eq(
        "role",
        "contractor"
      )
      .order(
        "full_name"
      );


  contractors =
    cs || [];


  const {
    data: wo
  } =
    await supabaseClient
      .from("work_orders")
      .select(
        "*,complaints(*)"
      )
      .order(
        "created_at",
        {
          ascending: false
        }
      );


  workOrders =
    wo || [];


  const counts = {

    normal: 0,
    medium: 0,
    serious: 0,
    closed: 0

  };


  officerComplaints.forEach(
    c => {

      if (
        c.status ===
        "Closed"
      )

        counts.closed++;

      else if (
        c.severity ===
        "Very Serious"
      )

        counts.serious++;

      else if (
        c.severity ===
        "Medium"
      )

        counts.medium++;

      else

        counts.normal++;

    }
  );


  $("off-total").textContent =
    officerComplaints.length;


  $("off-normal").textContent =
    counts.normal;


  $("off-medium").textContent =
    counts.medium;


  $("off-serious").textContent =
    counts.serious;


  $("off-closed").textContent =
    counts.closed;


  renderOfficerTable();

  renderVerification();

  drawOfficerMap();

}


function renderOfficerTable() {

  const f =
    $("severity-filter")
      .value;


  const rows =
    officerComplaints.filter(
      c =>
        f === "all" ||
        c.severity === f
    );


  $("officer-table")
    .innerHTML =

    rows.map(
      c => `

        <tr>

          <td>
            <b>
              ${esc(
                c.complaint_id
              )}
            </b>
          </td>

          <td>
            ${esc(
              c.defect_type ||
              "—"
            )}
          </td>

          <td>
            ${esc(c.locality)},
            ${esc(c.city)},
            ${esc(c.state)}
          </td>

          <td>
            ${c.latitude.toFixed(5)}
            <br>
            ${c.longitude.toFixed(5)}
          </td>

          <td>
            ${severityBadge(
              c.severity
            )}
          </td>

          <td>
            <b>
              ${c.priority ?? "—"}
            </b>/100
          </td>

          <td>
            ${esc(c.status)}
          </td>

          <td>

            ${
              c.status === "Reported"

                ? `

                  <button
                    class="btn small primary"
                    onclick="openAssignment('${c.complaint_id}')"
                  >
                    Review / Assign
                  </button>

                `

                : `

                  <button
                    class="btn small"
                    onclick="openComplaint('${c.complaint_id}')"
                  >
                    View
                  </button>

                `
            }

          </td>

        </tr>

      `
    ).join("")

    ||

    `
      <tr>
        <td colspan="8">
          No complaints.
        </td>
      </tr>
    `;

}


function drawOfficerMap() {

  if (officerMap)
    officerMap.remove();


  officerMap =
    L.map(
      "officer-map"
    ).setView(
      [16.3, 80.4],
      9
    );


  L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      attribution:
        "© OpenStreetMap"
    }
  ).addTo(
    officerMap
  );


  officerComplaints.forEach(
    c => {

      const color =
        c.severity ===
        "Very Serious"

          ? "#d9363e"

          : c.severity ===
            "Medium"

            ? "#e39b16"

            : "#1769e0";


      L.circleMarker(
        [
          c.latitude,
          c.longitude
        ],
        {

          color,

          fillColor:
            color,

          fillOpacity:
            .8,

          radius: 8

        }
      )

        .addTo(
          officerMap
        )

        .bindPopup(`

          <b>
            ${esc(
              c.complaint_id
            )}
          </b>

          <br>

          ${esc(
            c.locality
          )},
          ${esc(
            c.city
          )}

          <br>

          ${esc(
            c.severity
          )}

          •
          ${c.priority ?? 0}/100

        `);

    }
  );

}


async function openAssignment(
  id
) {

  const c =
    officerComplaints.find(
      x =>
        x.complaint_id === id
    );


  if (!c)
    return;


  const before =
    await signedUrl(
      "road-evidence",
      c.image_url
    );


  const opts =
    contractors
      .map(
        x => `

          <option value="${x.id}">
            ${esc(
              x.full_name ||
              x.id
            )}
          </option>

        `
      )
      .join("");


  const html = `

    <div class="item-card">

      <h3>
        Review
        ${esc(id)}
      </h3>

      <p>

        <b>Location:</b>
        ${esc(c.locality)},
        ${esc(c.city)},
        ${esc(c.state)}

        <br>

        <b>Coordinates:</b>
        ${c.latitude},
        ${c.longitude}

        <br>

        <b>Severity:</b>
        ${esc(c.severity)}

        •
        <b>Priority:</b>
        ${c.priority}/100

      </p>

      ${
        before
          ? `
            <img
              class="result-image"
              src="${before}"
              alt="Before"
            >
          `
          : ""
      }

      <div class="form-group">

        <label>
          Assign contractor
        </label>

        <select id="assign-contractor">

          ${opts}

        </select>

      </div>

      <button
        class="btn primary"
        onclick="assignWork('${id}')"
      >
        Create Work Order
      </button>

    </div>

  `;


  $("verification-list")
    .innerHTML =
    html +
    $("verification-list")
      .innerHTML;

}


async function assignWork(
  complaintId
) {

  const contractorId =
    $("assign-contractor")
      .value;


  if (!contractorId) {

    toast(
      "Select contractor."
    );

    return;
  }


  const {
    data,
    error
  } =
    await supabaseClient.rpc(
      "create_work_order",
      {
        target_complaint_id:
          complaintId,

        target_contractor_id:
          contractorId
      }
    );


  if (error) {

    toast(
      error.message ||
      error.details ||
      error.hint ||
      "Could not create the work order."
    );

    return;
  }


  toast(
    "Work order created and assigned."
  );


  loadOfficer();

}


function openComplaint(
  id
) {

  const c =
    officerComplaints.find(
      x =>
        x.complaint_id === id
    );


  if (c)

    toast(
      `${c.complaint_id}: ${c.status} • ${c.locality}, ${c.city}`
    );

}


async function renderVerification() {

  const rows =
    workOrders.filter(
      w =>
        w.status ===
        "Completed Awaiting Verification"
    );


  if (!rows.length) {

    $("verification-list")
      .innerHTML = `
        <div class="item-card">
          No completed repairs awaiting verification.
        </div>
      `;

    return;
  }


  $("verification-list")
    .innerHTML =

    await Promise.all(

      rows.map(
        async w => {

          const b =
            await signedUrl(
              "road-evidence",
              w.evidence_before_url
            );


          const a =
            await signedUrl(
              "repair-evidence",
              w.evidence_after_url
            );


          return `

            <div class="item-card">

              <div class="item-head">

                <div>

                  <b>
                    ${esc(
                      w.work_order_number
                    )}
                  </b>

                  <h3>
                    ${esc(
                      w.complaints?.defect_type ||
                      "Repair"
                    )}
                  </h3>

                </div>

                <span class="badge medium">
                  Awaiting verification
                </span>

              </div>


              <p>

                📍
                ${esc(
                  w.complaints?.locality
                )},
                ${esc(
                  w.complaints?.city
                )},
                ${esc(
                  w.complaints?.state
                )}

              </p>


              <div class="result-grid">

                ${
                  b

                    ? `

                      <div>

                        <small>
                          Before
                        </small>

                        <img
                          class="result-image"
                          src="${b}"
                        >

                      </div>

                    `

                    : ""
                }


                ${
                  a

                    ? `

                      <div>

                        <small>
                          After
                        </small>

                        <img
                          class="result-image"
                          src="${a}"
                        >

                      </div>

                    `

                    : ""
                }

              </div>


              <div class="actions">

                <button
                  class="btn primary"
                  onclick="verifyWork('${getWorkOrderId(w)}','approve')"
                >
                  Approve & Close
                </button>

                <button
                  class="btn"
                  onclick="verifyWork('${getWorkOrderId(w)}','reopen')"
                >
                  Reject / Reopen
                </button>

              </div>

            </div>

          `;

        }

      )

    ).then(
      x =>
        x.join("")
    );

}


async function verifyWork(
  id,
  action
) {

  const status =
    action === "approve"
      ? "Closed"
      : "Reopened";


  const {
    error
  } =
    await supabaseClient.rpc(
      "transition_work_order",
      {
        target_work_order_id:
          id,

        next_status:
          status
      }
    );


  if (error) {

    toast(
      error.message
    );

    return;
  }


  toast(
    action === "approve"
      ? "Work approved and complaint closed."
      : "Work reopened."
  );


  loadOfficer();

}


/* =========================================================
   CONTRACTOR
========================================================= */

async function loadContractor() {

  if (
    currentRole !==
    "contractor"
  )
    return;


  const {
    data,
    error
  } =
    await supabaseClient
      .from("work_orders")
      .select(
        "*,complaints(*)"
      )
      .eq(
        "contractor_id",
        currentUser.id
      )
      .order(
        "created_at",
        {
          ascending: false
        }
      );


  if (error) {

    toast(
      error.message
    );

    return;
  }


  workOrders =
    data || [];


  $("con-assigned")
    .textContent =
    workOrders.filter(
      w =>
        w.status ===
        "Assigned"
    ).length;


  $("con-progress")
    .textContent =
    workOrders.filter(
      w =>
        [
          "Accepted",
          "In Progress"
        ].includes(
          w.status
        )
    ).length;


  $("con-completed")
    .textContent =
    workOrders.filter(
      w =>
        [
          "Completed Awaiting Verification",
          "Closed"
        ].includes(
          w.status
        )
    ).length;


  $("contractor-list")
    .innerHTML =

    workOrders.length

      ? await Promise.all(

          workOrders.map(
            async w => {

              const before =
                await signedUrl(
                  "road-evidence",
                  w.evidence_before_url
                );


              const after =
                await signedUrl(
                  "repair-evidence",
                  w.evidence_after_url
                );


              return `

                <div class="item-card">

                  <div class="item-head">

                    <div>

                      <b>
                        ${esc(
                          w.work_order_number
                        )}
                      </b>

                      <h3>
                        ${esc(
                          w.complaints?.defect_type ||
                          "Repair"
                        )}
                      </h3>

                    </div>


                    <span
                      class="
                        badge
                        ${
                          w.status === "Closed"
                            ? "success"
                            : w.status === "In Progress"
                              ? "medium"
                              : "normal"
                        }
                      "
                    >
                      ${esc(
                        w.status
                      )}
                    </span>

                  </div>


                  <p>

                    📍
                    ${esc(
                      w.complaints?.locality
                    )},
                    ${esc(
                      w.complaints?.city
                    )},
                    ${esc(
                      w.complaints?.state
                    )}

                    <br>

                    Coordinates:
                    ${w.complaints?.latitude},
                    ${w.complaints?.longitude}

                    <br>

                    Priority:
                    ${w.complaints?.priority}/100

                  </p>


                  <div class="result-grid">

                    ${
                      before
                        ? `

                          <div>

                            <small>
                              Before image
                            </small>

                            <img
                              class="result-image"
                              src="${before}"
                            >

                          </div>

                        `
                        : ""
                    }


                    ${
                      after
                        ? `

                          <div>

                            <small>
                              After image
                            </small>

                            <img
                              class="result-image"
                              src="${after}"
                            >

                          </div>

                        `
                        : ""
                    }

                  </div>


                  <div class="actions">

                    ${
                      w.status === "Assigned"

                        ? `

                          <button
                            class="btn primary"
                            onclick="changeWork('${getWorkOrderId(w)}','Accepted')"
                          >
                            Accept Work
                          </button>

                        `

                        : ""
                    }


                    ${
                      w.status === "Accepted"

                        ? `

                          <button
                            class="btn primary"
                            onclick="changeWork('${getWorkOrderId(w)}','In Progress')"
                          >
                            Start Repair
                          </button>

                        `

                        : ""
                    }


                    ${
                      w.status === "In Progress"

                        ? `

                          <button
                            class="btn primary"
                            onclick="startContractorCapture('${getWorkOrderId(w)}')"
                          >
                            Capture After Image
                          </button>

                        `

                        : ""
                    }


                    ${
                      w.status ===
                      "Completed Awaiting Verification"

                        ? `

                          <span class="muted">
                            Submitted to municipal officer for verification.
                          </span>

                        `

                        : ""
                    }

                  </div>

                </div>

              `;

            }

          )

        ).then(
          x =>
            x.join("")
        )

      : `

        <div class="item-card">
          No assigned work orders.
        </div>

      `;

}


async function changeWork(
  id,
  status
) {

  const {
    error
  } =
    await supabaseClient.rpc(
      "transition_work_order",
      {
        target_work_order_id:
          id,

        next_status:
          status
      }
    );


  if (error) {

    toast(
      error.message
    );

    return;
  }


  loadContractor();

}


async function startContractorCapture(id) {

  closeContractorCapture();
  contractorCapture.workOrder = workOrders.find(
    workOrder => getWorkOrderId(workOrder) === id
  );

  if (!contractorCapture.workOrder) {
    toast("Work order details are unavailable. Refresh and try again.");
    return;
  }

  try {
    contractorCapture.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false
    });
    $("contractor-camera").srcObject = contractorCapture.stream;
    $("contractor-capture-status").textContent =
      "Capture the repair at the original pothole location.";
    $("contractor-capture").classList.remove("hidden");
  } catch (error) {
    toast("Camera access is required to capture repair evidence.");
    console.warn(error);
  }

}


function closeContractorCapture() {

  if (contractorCapture.stream) {
    contractorCapture.stream.getTracks().forEach(track => track.stop());
    contractorCapture.stream = null;
  }

  if ($("contractor-camera"))
    $("contractor-camera").srcObject = null;

  if ($("contractor-capture"))
    $("contractor-capture").classList.add("hidden");

}


function distanceInMeters(latitude1, longitude1, latitude2, longitude2) {

  const earthRadius = 6371000;
  const toRadians = value => value * Math.PI / 180;
  const deltaLatitude = toRadians(latitude2 - latitude1);
  const deltaLongitude = toRadians(longitude2 - longitude1);
  const a = Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(toRadians(latitude1)) *
    Math.cos(toRadians(latitude2)) *
    Math.sin(deltaLongitude / 2) ** 2;

  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

}


function getCurrentPosition() {

  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Location is not supported by this browser."));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0
    });
  });

}


async function captureContractorEvidence() {

  const workOrder = contractorCapture.workOrder;
  const video = $("contractor-camera");

  if (!workOrder || !video.videoWidth) {
    toast("Camera is not ready.");
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  const imageBlob = await new Promise(resolve =>
    canvas.toBlob(resolve, "image/jpeg", 0.9)
  );

  if (!imageBlob) {
    toast("Could not capture the image. Try again.");
    return;
  }

  $("contractor-capture-status").textContent = "Reading GPS location...";

  try {
    const position = await getCurrentPosition();
    const latitude = position.coords.latitude;
    const longitude = position.coords.longitude;
    const original = workOrder.complaints;
    const distance = distanceInMeters(
      original.latitude,
      original.longitude,
      latitude,
      longitude
    );

    if (distance > 20) {
      $("contractor-capture-status").textContent =
        `You are ${distance.toFixed(1)} m from the pothole. Move within 20 m and capture again.`;
      return;
    }

    await completeRepair(
      getWorkOrderId(workOrder),
      imageBlob,
      latitude,
      longitude,
      position.coords.accuracy || null
    );
  } catch (error) {
    $("contractor-capture-status").textContent =
      "Location access is required. Enable GPS and capture again.";
    toast(error.message || "Could not verify your location.");
  }

}


async function completeRepair(
  id,
  imageBlob,
  latitude,
  longitude,
  accuracy
) {

  const path =
    `repairs/${currentUser.id}/${id}-${Date.now()}.jpg`;


  try {

    const {
      error: uploadError
    } =
      await supabaseClient
        .storage
        .from(
          "repair-evidence"
        )
        .upload(
          path,
          imageBlob,
          {
            upsert: true,
            contentType:
              "image/jpeg"
          }
        );


    if (uploadError)
      throw uploadError;


    const {
      error
    } =
      await supabaseClient.rpc(
        "submit_repair_evidence",
        {
          target_work_order_id:
            id,

          target_after_url: path,
          target_latitude: latitude,
          target_longitude: longitude,
          target_accuracy: accuracy
        }
      );


    if (error)
      throw error;


    toast(
      "After-repair evidence submitted."
    );

    closeContractorCapture();


    loadContractor();

  } catch (err) {

    toast(
      "Evidence upload failed: " +
      err.message
    );

  }

}


/* =========================================================
   AUTH STATE
========================================================= */

supabaseClient.auth
  .onAuthStateChange(
    async (
      _event,
      session
    ) => {

      if (
        session?.user &&
        !currentUser
      ) {

        await finishLogin(
          session.user
        );

      }


      if (!session) {

        currentUser = null;
        currentProfile = null;
        currentRole = null;

      }

    }
  );


window.addEventListener(
  "load",
  async () => {

    const {
      data
    } =
      await supabaseClient
        .auth
        .getSession();


    if (data.session)

      await finishLogin(
        data.session.user
      );

    else

      showView(
        "view-login"
      );

  }
);
