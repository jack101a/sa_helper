(async () => {

    // 1️⃣ SHA-256 function
    async function hashSHA256(str) {
        const encoder = new TextEncoder();
        const data = encoder.encode(str);
        const hashBuffer = await crypto.subtle.digest("SHA-256", data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    }

    // 2️⃣ Input values safely get karo
    const llappln = document.querySelector('[name="llappln"]')?.value || "";
    const entcaptxt = document.querySelector('[name="entcaptxt"]')?.value || "";

    if (!llappln || !entcaptxt) {
        console.error("❌ llappln ya entcaptxt empty hai ya mil nahi raha.");
        return;
    }

    // 3️⃣ Concatenate
    const faceAuthString = llappln + entcaptxt;
    console.log("🔹 Combined String:", faceAuthString);

    // 4️⃣ Hash generate
    const faceAuthStatus = await hashSHA256(faceAuthString);
    console.log("🔐 Generated Hash:", faceAuthStatus);

    // 5️⃣ jQuery check
    if (typeof $ === "undefined") {
        console.error("❌ jQuery loaded nahi hai.");
        return;
    }

    // 6️⃣ AJAX request
    $.ajax({
        type: "POST",
        url: "faceAuthStatus.do",
        data: {
            faceAuthStatus: faceAuthStatus
        },
        dataType: "json",
        success: function (response) {
            console.log("✅ Success:", response);
        },
        error: function (xhr, status, error) {
            console.log("❌ Error Status:", status);
            console.log("❌ Error Message:", error);
            console.log("❌ Full Response:", xhr.responseText);
        }
    });

})();